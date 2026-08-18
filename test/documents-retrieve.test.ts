import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logAction } = vi.hoisted(() => ({ logAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/audit', () => ({ logAction }));

const { getDocument, presignGetUrl } = vi.hoisted(() => ({
  getDocument: vi.fn(),
  presignGetUrl: vi.fn(),
}));
vi.mock('../services/api/documents/src/client', () => ({
  IS_MOCK: true,
  TTL_SECONDS: 300,
  ORG_ID: 'org-1',
  ACTOR_ID: 'cli-system',
  getDocument,
  presignGetUrl,
}));

import { retrieveDocumentUrl, isExpired } from '../services/api/documents/src/retrieve';
import { AccessDeniedError, type AccessSubject } from '../lib/rbac';

const subject = (role: AccessSubject['role']): AccessSubject => ({
  volunteerId: 'vol-1',
  orgId: 'org-1',
  role,
});

const DOC = {
  id: 'doc-1',
  org_id: 'org-1',
  s3_key: 'org-1/doc-1/original.pdf',
  doc_type: 'receipt',
  status: 'approved',
  uploaded_by: 'someone-else',
};

const RETRIEVE_OPTS = { bucket: 'fiscus-ingestion-local', region: 'us-east-1' };

beforeEach(() => {
  logAction.mockReset();
  logAction.mockResolvedValue(undefined);
  getDocument.mockReset();
  presignGetUrl.mockReset();
});

describe('retrieveDocumentUrl — A4 RBAC gate', () => {
  it('rejects data_entry before touching the document lookup or presign, and audits the denial', async () => {
    await expect(retrieveDocumentUrl(subject('data_entry'), 'doc-1', RETRIEVE_OPTS)).rejects.toThrow(AccessDeniedError);

    expect(getDocument).not.toHaveBeenCalled();
    expect(presignGetUrl).not.toHaveBeenCalled();
    expect(logAction).toHaveBeenCalledTimes(1);
    expect(logAction).toHaveBeenCalledWith('org-1', 'vol-1', 'access_denied', 'documents', 'doc-1', {
      role: 'data_entry',
      capability: 'view_raw_document',
    });
  });

  it('rejects leadership the same way', async () => {
    await expect(retrieveDocumentUrl(subject('leadership'), 'doc-1', RETRIEVE_OPTS)).rejects.toThrow(AccessDeniedError);

    expect(getDocument).not.toHaveBeenCalled();
    expect(presignGetUrl).not.toHaveBeenCalled();
    expect(logAction).toHaveBeenCalledWith('org-1', 'vol-1', 'access_denied', 'documents', 'doc-1', {
      role: 'leadership',
      capability: 'view_raw_document',
    });
  });

  it('allows reviewer and treasurer through to a presigned URL, auditing view_raw_document', async () => {
    getDocument.mockResolvedValue(DOC);
    presignGetUrl.mockResolvedValue('mock://local-download/fiscus-ingestion-local/org-1/doc-1/original.pdf?expires=123');

    for (const role of ['reviewer', 'treasurer'] as const) {
      logAction.mockClear();
      const result = await retrieveDocumentUrl(subject(role), 'doc-1', RETRIEVE_OPTS);
      expect(result.url).toContain('doc-1/original.pdf');
      expect(result.ttlSeconds).toBe(300);
      expect(logAction).toHaveBeenCalledWith('org-1', 'vol-1', 'view_raw_document', 'documents', 'doc-1', {
        s3Key: DOC.s3_key,
        expiresAt: result.expiresAt,
        mock: true,
      });
    }
  });

  it('never grants data_entry access to raw documents even ones it uploaded itself (no owner carve-out for this capability)', async () => {
    getDocument.mockResolvedValue({ ...DOC, uploaded_by: 'vol-1' });
    await expect(retrieveDocumentUrl(subject('data_entry'), 'doc-1', RETRIEVE_OPTS)).rejects.toThrow(AccessDeniedError);
    expect(getDocument).not.toHaveBeenCalled();
  });

  it('throws (without auditing a fake success) when the document does not exist in this org', async () => {
    getDocument.mockResolvedValue(null);
    await expect(retrieveDocumentUrl(subject('treasurer'), 'missing-doc', RETRIEVE_OPTS)).rejects.toThrow(/not found/);
    expect(presignGetUrl).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });
});

describe('retrieveDocumentUrl / isExpired — 5-minute TTL math', () => {
  it('computes an expiresAt exactly TTL_SECONDS after the injected clock, and presigns with that same issuedAt', async () => {
    getDocument.mockResolvedValue(DOC);
    presignGetUrl.mockResolvedValue('mock://local-download/fiscus-ingestion-local/org-1/doc-1/original.pdf?expires=123');

    const issuedAt = new Date('2026-08-18T12:00:00.000Z');
    const result = await retrieveDocumentUrl(subject('reviewer'), 'doc-1', { ...RETRIEVE_OPTS, now: () => issuedAt });

    expect(result.expiresAt).toBe('2026-08-18T12:05:00.000Z');
    expect(presignGetUrl).toHaveBeenCalledWith(DOC.s3_key, {
      bucket: RETRIEVE_OPTS.bucket,
      region: RETRIEVE_OPTS.region,
      ttlSeconds: 300,
      issuedAt,
    });
  });

  it('is not expired just before the 5-minute mark and is expired at/after it', async () => {
    getDocument.mockResolvedValue(DOC);
    presignGetUrl.mockResolvedValue('mock://local-download/fiscus-ingestion-local/org-1/doc-1/original.pdf?expires=123');

    const issuedAt = new Date('2026-08-18T12:00:00.000Z');
    const result = await retrieveDocumentUrl(subject('treasurer'), 'doc-1', { ...RETRIEVE_OPTS, now: () => issuedAt });

    const justBefore = new Date('2026-08-18T12:04:59.999Z');
    const exactlyAt = new Date('2026-08-18T12:05:00.000Z');
    const wellAfter = new Date('2026-08-18T12:10:00.000Z');

    expect(isExpired(result, justBefore)).toBe(false);
    expect(isExpired(result, exactlyAt)).toBe(true);
    expect(isExpired(result, wellAfter)).toBe(true);
  });
});
