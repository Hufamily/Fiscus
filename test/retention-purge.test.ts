import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logAction } = vi.hoisted(() => ({ logAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/audit', () => ({ logAction }));

const ORG_SHORT = '11111111-1111-4111-8111-111111111111'; // retention_years: 1
const ORG_NORMAL = '22222222-2222-4222-8222-222222222222'; // retention_years: 7

const EXPIRED_DOC = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  org_id: ORG_SHORT,
  s3_key: `${ORG_SHORT}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/original.pdf`,
  doc_type: 'receipt',
  status: 'approved',
  uploaded_by: 'vol-1',
  created_at: '2020-01-01T00:00:00.000Z',
};

const WITHIN_WINDOW_DOC = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  org_id: ORG_NORMAL,
  s3_key: `${ORG_NORMAL}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/original.pdf`,
  doc_type: 'receipt',
  status: 'approved',
  uploaded_by: 'vol-2',
  created_at: '2026-08-01T00:00:00.000Z',
};

// Aggregate-relevant fields (what D2's getAggregates() reads: category,
// status, amount_cents) on the transaction derived from EXPIRED_DOC --
// purging the document must leave this row byte-identical.
const SURVIVING_TRANSACTION = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  org_id: ORG_SHORT,
  document_id: EXPIRED_DOC.id,
  category: 'veterinary',
  amount_cents: 12345,
  currency: 'USD',
  txn_date: '2020-01-01',
  extracted_fields_json: { vendor: 'Test Vendor' },
  status: 'approved',
};

function seedDb() {
  return {
    organizations: [
      { id: ORG_SHORT, name: 'Test Org (short retention)', retention_years: 1 },
      { id: ORG_NORMAL, name: 'Test Org (normal retention)', retention_years: 7 },
    ],
    documents: [{ ...EXPIRED_DOC }, { ...WITHIN_WINDOW_DOC }],
    transactions: [{ ...SURVIVING_TRANSACTION }],
    s3_objects: [EXPIRED_DOC.s3_key, WITHIN_WINDOW_DOC.s3_key],
    audit_log: [] as unknown[],
  };
}

// In-memory stand-in for client.ts's mock-db read/write, so the test doesn't
// touch the checked-in fixtures/mock-db.json (mirrors why the CI-widening
// session's tests mock client.ts rather than hitting real fixture files).
let db = seedDb();

const {
  fetchOrganizations,
  fetchPurgeCandidates,
  markDocumentPurged,
  deleteS3Object,
} = vi.hoisted(() => ({
  fetchOrganizations: vi.fn(),
  fetchPurgeCandidates: vi.fn(),
  markDocumentPurged: vi.fn(),
  deleteS3Object: vi.fn(),
}));

vi.mock('../services/lifecycle/retention/src/client', () => ({
  IS_MOCK: true,
  SYSTEM_ACTOR: 'retention-lifecycle-system',
  DEFAULT_RETENTION_YEARS: 7,
  INGESTION_BUCKET: 'fiscus-ingestion-local',
  fetchOrganizations,
  fetchPurgeCandidates,
  markDocumentPurged,
  deleteS3Object,
}));

import { computeCutoff, purgeExpiredDocuments } from '../services/lifecycle/retention/src/purge';

beforeEach(() => {
  db = seedDb();
  logAction.mockReset();
  logAction.mockResolvedValue(undefined);

  fetchOrganizations.mockReset();
  fetchOrganizations.mockImplementation(async () => db.organizations);

  fetchPurgeCandidates.mockReset();
  fetchPurgeCandidates.mockImplementation(async (orgId: string, cutoffIso: string) =>
    db.documents.filter(
      (d) => d.org_id === orgId && d.status !== 'purged' && new Date(d.created_at).getTime() < new Date(cutoffIso).getTime(),
    ),
  );

  markDocumentPurged.mockReset();
  markDocumentPurged.mockImplementation(async (documentId: string, orgId: string) => {
    const doc = db.documents.find((d) => d.id === documentId && d.org_id === orgId);
    if (doc) doc.status = 'purged';
  });

  deleteS3Object.mockReset();
  deleteS3Object.mockImplementation(async (_bucket: string, key: string) => {
    db.s3_objects = db.s3_objects.filter((k) => k !== key);
  });
});

describe('computeCutoff', () => {
  it('subtracts retention_years (UTC) from the reference date', () => {
    const now = new Date('2026-08-18T00:00:00.000Z');
    expect(computeCutoff(1, now).toISOString()).toBe('2025-08-18T00:00:00.000Z');
    expect(computeCutoff(7, now).toISOString()).toBe('2019-08-18T00:00:00.000Z');
  });
});

describe('purgeExpiredDocuments', () => {
  const NOW = new Date('2026-08-18T00:00:00.000Z');

  it('purges a document past its org retention window: deletes S3 object, flips status, audit-logs', async () => {
    const results = await purgeExpiredDocuments(NOW);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      orgId: ORG_SHORT,
      documentId: EXPIRED_DOC.id,
      s3Key: EXPIRED_DOC.s3_key,
      retentionYears: 1,
    });

    expect(deleteS3Object).toHaveBeenCalledWith('fiscus-ingestion-local', EXPIRED_DOC.s3_key);
    expect(markDocumentPurged).toHaveBeenCalledWith(EXPIRED_DOC.id, ORG_SHORT);

    const doc = db.documents.find((d) => d.id === EXPIRED_DOC.id)!;
    expect(doc.status).toBe('purged');
    expect(db.s3_objects).not.toContain(EXPIRED_DOC.s3_key);

    expect(logAction).toHaveBeenCalledWith(
      ORG_SHORT,
      'retention-lifecycle-system',
      'document_purged',
      'documents',
      EXPIRED_DOC.id,
      expect.objectContaining({ s3Key: EXPIRED_DOC.s3_key, retentionYears: 1 }),
    );
  });

  it('leaves a document within its org retention window untouched', async () => {
    await purgeExpiredDocuments(NOW);

    expect(deleteS3Object).not.toHaveBeenCalledWith('fiscus-ingestion-local', WITHIN_WINDOW_DOC.s3_key);
    expect(markDocumentPurged).not.toHaveBeenCalledWith(WITHIN_WINDOW_DOC.id, ORG_NORMAL);

    const doc = db.documents.find((d) => d.id === WITHIN_WINDOW_DOC.id)!;
    expect(doc.status).toBe('approved');
    expect(db.s3_objects).toContain(WITHIN_WINDOW_DOC.s3_key);

    expect(logAction).not.toHaveBeenCalledWith(
      ORG_NORMAL,
      expect.anything(),
      'document_purged',
      'documents',
      WITHIN_WINDOW_DOC.id,
      expect.anything(),
    );
  });

  it('does not mutate the aggregate-relevant transaction fields D2 reads (category, status, amount_cents)', async () => {
    const before = { ...SURVIVING_TRANSACTION };

    await purgeExpiredDocuments(NOW);

    // purge.ts never touches db.transactions at all -- assert the row D2's
    // getAggregates() would read (category/status/amount_cents) survives
    // byte-identical after its parent document is purged.
    const after = db.transactions.find((t) => t.id === SURVIVING_TRANSACTION.id)!;
    expect(after.category).toBe(before.category);
    expect(after.status).toBe(before.status);
    expect(after.amount_cents).toBe(before.amount_cents);
    expect(after).toEqual(before);
  });
});
