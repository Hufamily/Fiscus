// C4: agent action audit trail integration.
//
// This is 1 of 3 files exercising the 5 action types the issue calls out
// ("extraction saved, correction applied, template used, anomaly flagged,
// session resumed"). Split across files because Vitest's vi.mock() is
// hoisted to the top of its *file*, not scoped to a describe block -- two
// describes in one file that mock the same module path (e.g. both
// services/ingestion/embeddings/src/{client,anomaly}) silently collide, with
// only the last-registered mock winning for the whole file. Splitting by
// which modules a flow needs mocked keeps each file's mocks unambiguous:
//   - this file: extraction saved (s3-extraction pipeline) + session resumed
//   - test/audit-trail-template-used.test.ts: fields_extracted + template used
//     (embeddings CLI pipeline)
//   - test/audit-trail-anomaly.test.ts: anomaly flagged
// All three assert exactly one audit_log row per action via a mocked
// lib/audit.ts logAction, with a detail_json shape Track D's reporting can
// query across action types without per-type special-casing (consistent
// snake_case keys, org_id/document_id/transaction_id where relevant -- see
// AGENTS.md §4's audit_log contract).
//
// "correction applied" is intentionally NOT driven by any of the three: as
// of this session there is no real backend write path for it anywhere in
// the repo. `services/web/src/api/mock.ts`'s `applyCorrection` is a
// front-end mock only, and `db/seed.ts`'s `correction_applied` log is
// fixture-seed data (requires a live COCKROACH_DATABASE_URL, calls
// `process.exit` at import time if one isn't set, and isn't reachable
// through IS_MOCK the way every other module here is) -- not a reusable,
// mockable flow. This is C3 (issue #12, "learned corrections"), which had
// not landed on origin at the time this branch was built (see CLAUDE.md
// Learnings and the issue's own "if C3 isn't pushed yet, proceed without
// it" note). The `it.todo` below documents the shape the real flow should
// produce once C3 lands, so whoever picks it up wires straight into the
// standard established by the other 4 actions instead of inventing a fifth.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logAction } = vi.hoisted(() => ({ logAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/audit', () => ({ logAction }));

const { readMockDb, writeMockDb } = vi.hoisted(() => ({
  readMockDb: vi.fn(),
  writeMockDb: vi.fn(),
}));
vi.mock('../services/ingestion/s3-extraction/src/client', () => ({
  IS_MOCK: true,
  SYSTEM_ACTOR: 's3-lambda-bedrock',
  readMockDb,
  writeMockDb,
  getPool: vi.fn(),
}));

const { getOpenBatchSession, createBatchSession, advanceBatchSession } = vi.hoisted(() => ({
  getOpenBatchSession: vi.fn(),
  createBatchSession: vi.fn(),
  advanceBatchSession: vi.fn(),
}));
vi.mock('../services/agent/src/client', () => ({
  ORG_ID: 'org-1',
  VOLUNTEER_ID: 'vol-1',
  getOpenBatchSession,
  createBatchSession,
  advanceBatchSession,
}));

beforeEach(() => {
  logAction.mockClear();
});

// ── 1. extraction saved (services/ingestion/s3-extraction/src/repository.ts) ──
describe('extraction saved', () => {
  it('produces exactly one extraction_saved row with document_id in detail_json', async () => {
    const { saveExtraction } = await import('../services/ingestion/s3-extraction/src/repository.js');
    const identity = { orgId: 'org-1', documentId: 'doc-1', s3Key: 's3://bucket/doc-1.pdf' };
    readMockDb.mockReturnValue({
      documents: [{ id: 'doc-1', org_id: 'org-1', s3_key: identity.s3Key, doc_type: 'receipt', status: 'uploaded', uploaded_by: 'vol-1' }],
      transactions: [],
      audit_log: [],
    });

    const outcome = await saveExtraction(identity, {
      vendor: 'Acme Vet', transactionDate: '2026-01-01', amountCents: 1000, currency: 'USD', lineItems: [],
    });

    expect(outcome).toBe('saved');
    expect(logAction).toHaveBeenCalledTimes(1);
    const [orgId, actorId, action, targetTable, , detail] = logAction.mock.calls[0];
    expect(orgId).toBe('org-1');
    expect(actorId).toBe('s3-lambda-bedrock');
    expect(action).toBe('extraction_saved');
    expect(targetTable).toBe('transactions');
    expect(detail).toMatchObject({ document_id: 'doc-1' });
  });

  it('does not double-log on a duplicate extraction for an already-processed document', async () => {
    const { saveExtraction } = await import('../services/ingestion/s3-extraction/src/repository.js');
    const identity = { orgId: 'org-1', documentId: 'doc-2', s3Key: 's3://bucket/doc-2.pdf' };
    readMockDb.mockReturnValue({
      documents: [{ id: 'doc-2', org_id: 'org-1', s3_key: identity.s3Key, doc_type: 'receipt', status: 'needs_review', uploaded_by: 'vol-1' }],
      transactions: [{ id: 'txn-existing', org_id: 'org-1', document_id: 'doc-2' }],
      audit_log: [],
    });

    const outcome = await saveExtraction(identity, {
      vendor: 'Acme Vet', transactionDate: '2026-01-01', amountCents: 1000, currency: 'USD', lineItems: [],
    });

    expect(outcome).toBe('duplicate');
    expect(logAction).not.toHaveBeenCalled();
  });
});

// ── 2. session resumed (services/agent/src/batch-session.ts) ──
describe('session resumed', () => {
  it('produces exactly one batch_resumed row when an open batch is found', async () => {
    getOpenBatchSession.mockResolvedValue({
      id: 'sess-1', org_id: 'org-1', volunteer_id: 'vol-1',
      pending_documents: {}, current_index: 1,
      batch_document_ids: ['doc-a', 'doc-b', 'doc-c'], batch_status: 'in_progress',
      updated_at: new Date().toISOString(),
    });

    const { resumeOpenBatch } = await import('../services/agent/src/batch-session.js');
    const resumed = await resumeOpenBatch('org-1', 'vol-1');

    expect(resumed).not.toBeNull();
    expect(resumed!.nextDocumentId).toBe('doc-b');
    expect(logAction).toHaveBeenCalledTimes(1);
    expect(logAction).toHaveBeenCalledWith(
      'org-1', 'vol-1', 'batch_resumed', 'sessions', 'sess-1',
      expect.objectContaining({ document_id: 'doc-b', current_index: 1, document_count: 3 }),
    );
  });

  it('does not log anything when there is nothing to resume', async () => {
    getOpenBatchSession.mockResolvedValue(null);

    const { resumeOpenBatch } = await import('../services/agent/src/batch-session.js');
    const resumed = await resumeOpenBatch('org-1', 'nobody');

    expect(resumed).toBeNull();
    expect(logAction).not.toHaveBeenCalled();
  });
});

// ── 3. correction applied — blocked on C3 (issue #12), not yet landed ──
describe('correction applied', () => {
  it.todo(
    'once C3 lands a real applyCorrection write path, it should call ' +
    "logAction(orgId, correctedBy, 'correction_applied', 'corrections', correctionId, " +
    '{ transaction_id, field, original_value, corrected_value }) exactly once per ' +
    "correction -- matching db/seed.ts's target_table/action and the front-end's " +
    'Correction shape (services/web/src/types.ts), with detail_json keys in the same ' +
    'snake_case document_id/transaction_id style as the other 4 actions.',
  );
});
