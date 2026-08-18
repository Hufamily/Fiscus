// C4: agent action audit trail integration — extraction saved (embeddings CLI
// pipeline) + template used. See test/audit-trail-integration.test.ts's file
// header for why this is a separate file from the other C4 flows (vi.mock is
// file-scoped, and this flow needs services/ingestion/embeddings/src/anomaly
// mocked out, which would otherwise collide with test/audit-trail-anomaly.test.ts's
// need for the *real* anomaly.ts).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync } from 'fs';
import path from 'path';
import os from 'os';

const { logAction } = vi.hoisted(() => ({ logAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/audit', () => ({ logAction }));

const { insertDocument, insertTransaction, getMockExtraction, searchTemplates } = vi.hoisted(() => ({
  insertDocument: vi.fn(),
  insertTransaction: vi.fn(),
  getMockExtraction: vi.fn(),
  searchTemplates: vi.fn(),
}));
vi.mock('../services/ingestion/embeddings/src/client', () => ({
  IS_MOCK: true,
  ORG_ID: 'org-1',
  insertDocument,
  insertTransaction,
  getMockExtraction,
  searchTemplates,
  invokeModel: vi.fn(),
}));

const { checkAndFlagAnomaly } = vi.hoisted(() => ({ checkAndFlagAnomaly: vi.fn() }));
vi.mock('../services/ingestion/embeddings/src/anomaly', () => ({ checkAndFlagAnomaly }));

vi.mock('../lib/embeddings', () => ({ embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) }));

describe('extraction saved (embeddings CLI pipeline) + template used', () => {
  let tmpFile: string;

  beforeEach(() => {
    logAction.mockClear();
    tmpFile = path.join(os.tmpdir(), `fiscus-audit-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    writeFileSync(tmpFile, 'Vet Invoice — total $244.69, card 4111 1111 1111 1111');
    getMockExtraction.mockReturnValue({
      category: 'veterinary', amount_cents: 24469, currency: 'USD', txn_date: '2026-01-01', extracted_fields: [],
    });
    insertDocument.mockResolvedValue({ id: 'doc-9', org_id: 'org-1', s3_key: 'local/x', doc_type: 'vet_invoice', status: 'approved', uploaded_by: 'cli-system', created_at: new Date().toISOString() });
    insertTransaction.mockResolvedValue({ id: 'txn-9', org_id: 'org-1', document_id: 'doc-9', category: 'veterinary', amount_cents: 24469, currency: 'USD', txn_date: '2026-01-01', extracted_fields_json: [], embedding: [], status: 'pending_review', created_at: new Date().toISOString() });
    checkAndFlagAnomaly.mockResolvedValue({ flagged: false, neighbors: [] });
  });

  afterEach(() => {
    try { unlinkSync(tmpFile); } catch { /* best-effort cleanup */ }
  });

  it('logs exactly one fields_extracted row with document_id/s3_key, and one template_used row when a close approved template match exists', async () => {
    searchTemplates.mockResolvedValue([{ id: 'tmpl-1', form_type: 'vet_invoice', status: 'approved', distance: 1.2 }]);

    const { embedFiles } = await import('../services/ingestion/embeddings/src/embed.js');
    await embedFiles([tmpFile], 'vet_invoice');

    const extractedCalls = logAction.mock.calls.filter((c) => c[2] === 'fields_extracted');
    const templateCalls = logAction.mock.calls.filter((c) => c[2] === 'template_used');
    expect(extractedCalls).toHaveLength(1);
    expect(extractedCalls[0][3]).toBe('transactions');
    expect(extractedCalls[0][5]).toMatchObject({ document_id: 'doc-9', s3_key: 'local/x' });

    expect(templateCalls).toHaveLength(1);
    expect(templateCalls[0][3]).toBe('templates');
    expect(templateCalls[0][4]).toBe('tmpl-1');
    expect(templateCalls[0][5]).toMatchObject({ document_id: 'doc-9', transaction_id: 'txn-9', form_type: 'vet_invoice' });
  });

  it('does not log template_used when no approved template is close enough', async () => {
    searchTemplates.mockResolvedValue([{ id: 'tmpl-2', form_type: 'unrelated', status: 'approved', distance: 50 }]);

    const { embedFiles } = await import('../services/ingestion/embeddings/src/embed.js');
    await embedFiles([tmpFile], 'vet_invoice');

    expect(logAction.mock.calls.filter((c) => c[2] === 'template_used')).toHaveLength(0);
    expect(logAction.mock.calls.filter((c) => c[2] === 'fields_extracted')).toHaveLength(1);
  });

  it('does not log template_used for a matching but still pending_review template', async () => {
    searchTemplates.mockResolvedValue([{ id: 'tmpl-3', form_type: 'vet_invoice', status: 'pending_review', distance: 0.5 }]);

    const { embedFiles } = await import('../services/ingestion/embeddings/src/embed.js');
    await embedFiles([tmpFile], 'vet_invoice');

    expect(logAction.mock.calls.filter((c) => c[2] === 'template_used')).toHaveLength(0);
  });
});
