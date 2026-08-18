// Integration tests for repository.ts's mock-mode DB writes. This mocks
// client.ts's readMockDb/writeMockDb (vi.fn() returning/capturing in-memory
// state) rather than exercising the real fixtures/mock-db.json file, so
// running this suite never leaves the checked-in fixture dirty — mirrors the
// vi.mock('.../client') pattern in test/agent.test.ts and
// test/template-gen.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logAction } = vi.hoisted(() => ({ logAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/audit', () => ({ logAction }));

const { readMockDb, writeMockDb, getPool } = vi.hoisted(() => ({
  readMockDb: vi.fn(),
  writeMockDb: vi.fn(),
  getPool: vi.fn(),
}));
vi.mock('../services/ingestion/s3-extraction/src/client', () => ({
  IS_MOCK: true,
  SYSTEM_ACTOR: 's3-lambda-bedrock',
  readMockDb,
  writeMockDb,
  getPool,
}));

import { recordUpload, saveExtraction, markNeedsReview } from '../services/ingestion/s3-extraction/src/repository';

const ORG_ID = '123e4567-e89b-42d3-a456-426614174000';
const DOCUMENT_ID = '223e4567-e89b-42d3-a456-426614174000';
const IDENTITY = { orgId: ORG_ID, documentId: DOCUMENT_ID, s3Key: `${ORG_ID}/${DOCUMENT_ID}/original.pdf` };

const EXTRACTION = {
  vendor: 'Community Market',
  transactionDate: '2026-08-18',
  amountCents: 1250,
  currency: 'USD',
  lineItems: [{ description: 'Food', amountCents: 1250 }],
  category: 'supplies',
};

function emptyDb() {
  return { documents: [] as any[], transactions: [] as any[], audit_log: [] as any[] };
}

beforeEach(() => {
  logAction.mockClear();
  readMockDb.mockReset();
  writeMockDb.mockReset();
  getPool.mockReset();
});

describe('recordUpload() — mock mode', () => {
  it('registers a new document and audits the upload', async () => {
    const db = emptyDb();
    readMockDb.mockReturnValue(db);

    await recordUpload(IDENTITY, 'vol-1');

    expect(writeMockDb).toHaveBeenCalledTimes(1);
    const written = writeMockDb.mock.calls[0][0];
    expect(written.documents).toHaveLength(1);
    expect(written.documents[0]).toMatchObject({
      id: DOCUMENT_ID,
      org_id: ORG_ID,
      status: 'uploaded',
      uploaded_by: 'vol-1',
    });
    expect(logAction).toHaveBeenCalledWith(ORG_ID, 'vol-1', 'document_uploaded', 'documents', DOCUMENT_ID, {
      s3Key: IDENTITY.s3Key,
    });
  });

  it('is idempotent for a document id already registered', async () => {
    const db = emptyDb();
    db.documents.push({ id: DOCUMENT_ID, org_id: ORG_ID, s3_key: IDENTITY.s3Key, doc_type: 'receipt', status: 'uploaded', uploaded_by: 'vol-1' });
    readMockDb.mockReturnValue(db);

    await recordUpload(IDENTITY, 'vol-1');

    expect(writeMockDb).not.toHaveBeenCalled();
    expect(logAction).toHaveBeenCalledTimes(1);
  });
});

describe('saveExtraction() — mock mode', () => {
  it('throws if the document was never registered', async () => {
    readMockDb.mockReturnValue(emptyDb());
    await expect(saveExtraction(IDENTITY, EXTRACTION)).rejects.toThrow(/not registered/);
    expect(writeMockDb).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it('persists a pending_review transaction, flips the document to needs_review, and audits it', async () => {
    const db = emptyDb();
    db.documents.push({ id: DOCUMENT_ID, org_id: ORG_ID, s3_key: IDENTITY.s3Key, doc_type: 'receipt', status: 'uploaded', uploaded_by: 'vol-1' });
    readMockDb.mockReturnValue(db);

    const outcome = await saveExtraction(IDENTITY, EXTRACTION);

    expect(outcome).toBe('saved');
    const written = writeMockDb.mock.calls[0][0];
    expect(written.transactions).toHaveLength(1);
    expect(written.transactions[0]).toMatchObject({
      org_id: ORG_ID,
      document_id: DOCUMENT_ID,
      category: 'supplies',
      amount_cents: 1250,
      currency: 'USD',
      status: 'pending_review',
    });
    expect(written.documents[0].status).toBe('needs_review');
    expect(logAction).toHaveBeenCalledWith(ORG_ID, 's3-lambda-bedrock', 'extraction_saved', 'transactions', expect.any(String), {
      documentId: DOCUMENT_ID,
      source: 's3-lambda-bedrock',
    });
  });

  it('returns "duplicate" without writing a second transaction for the same document', async () => {
    const db = emptyDb();
    db.documents.push({ id: DOCUMENT_ID, org_id: ORG_ID, s3_key: IDENTITY.s3Key, doc_type: 'receipt', status: 'needs_review', uploaded_by: 'vol-1' });
    db.transactions.push({ id: 'txn-existing', org_id: ORG_ID, document_id: DOCUMENT_ID, category: 'supplies', amount_cents: 1250, currency: 'USD', txn_date: '2026-08-01', extracted_fields_json: {}, status: 'pending_review' });
    readMockDb.mockReturnValue(db);

    const outcome = await saveExtraction(IDENTITY, EXTRACTION);

    expect(outcome).toBe('duplicate');
    expect(writeMockDb).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it('defaults category to "uncategorized" when the extraction has none', async () => {
    const db = emptyDb();
    db.documents.push({ id: DOCUMENT_ID, org_id: ORG_ID, s3_key: IDENTITY.s3Key, doc_type: 'receipt', status: 'uploaded', uploaded_by: 'vol-1' });
    readMockDb.mockReturnValue(db);

    await saveExtraction(IDENTITY, { ...EXTRACTION, category: undefined });

    const written = writeMockDb.mock.calls[0][0];
    expect(written.transactions[0].category).toBe('uncategorized');
  });
});

describe('markNeedsReview() — mock mode', () => {
  it('flips a registered document to needs_review and audits the failure reason', async () => {
    const db = emptyDb();
    db.documents.push({ id: DOCUMENT_ID, org_id: ORG_ID, s3_key: IDENTITY.s3Key, doc_type: 'receipt', status: 'uploaded', uploaded_by: 'vol-1' });
    readMockDb.mockReturnValue(db);

    await markNeedsReview(IDENTITY, 'Bedrock extraction is disabled by the Free Tier cost guard');

    const written = writeMockDb.mock.calls[0][0];
    expect(written.documents[0].status).toBe('needs_review');
    expect(logAction).toHaveBeenCalledWith(ORG_ID, 's3-lambda-bedrock', 'extraction_failed', 'documents', DOCUMENT_ID, {
      reason: 'Bedrock extraction is disabled by the Free Tier cost guard',
      source: 's3-lambda-bedrock',
    });
  });

  it('is a no-op when a transaction already exists for the document (already extracted)', async () => {
    const db = emptyDb();
    db.documents.push({ id: DOCUMENT_ID, org_id: ORG_ID, s3_key: IDENTITY.s3Key, doc_type: 'receipt', status: 'needs_review', uploaded_by: 'vol-1' });
    db.transactions.push({ id: 'txn-existing', org_id: ORG_ID, document_id: DOCUMENT_ID, category: 'supplies', amount_cents: 1250, currency: 'USD', txn_date: '2026-08-01', extracted_fields_json: {}, status: 'pending_review' });
    readMockDb.mockReturnValue(db);

    await markNeedsReview(IDENTITY, 'some transient error');

    expect(writeMockDb).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });
});
