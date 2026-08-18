// C3: org-specific learned corrections memory — unit tests for the grouping/
// confidence logic in corrections-memory.ts, plus an end-to-end test against
// the embed.ts pipeline proving the acceptance criterion literally:
// "after correcting the same mistake twice for an org, the third identical
// document is extracted correctly without volunteer input" and "clearly
// distinguishable in logs when memory changed the outcome."
//
// Mirrors the vi.mock('.../client') pattern from test/search-anomaly.test.ts
// and test/summaries.test.ts — this feature writes (adjusts the persisted
// extraction, audit-logs), so mocking the client/anomaly/audit modules keeps
// the working tree clean instead of hitting the real fixtures/mock-db.json.
// All vi.mock calls live at module top level (not nested in describe blocks)
// since Vitest hoists them and a module path must only be mocked once.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExtractionResult } from '../services/ingestion/embeddings/src/types';

const { logAction } = vi.hoisted(() => ({ logAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/audit', () => ({ logAction }));

const {
  searchCorrectionMemory, invokeModel, getMockExtraction, insertDocument, insertTransaction,
} = vi.hoisted(() => ({
  searchCorrectionMemory: vi.fn(),
  invokeModel: vi.fn(),
  getMockExtraction: vi.fn(),
  insertDocument: vi.fn(),
  insertTransaction: vi.fn(),
}));
vi.mock('../services/ingestion/embeddings/src/client', () => ({
  searchCorrectionMemory, invokeModel, getMockExtraction, insertDocument, insertTransaction,
  IS_MOCK: true,
  ORG_ID: 'org-1',
}));

vi.mock('../services/ingestion/embeddings/src/anomaly', () => ({
  checkAndFlagAnomaly: vi.fn().mockResolvedValue({ flagged: false, neighbors: [] }),
  DEFAULT_DISTANCE_THRESHOLD: 8,
}));

import {
  applyCorrectionMemory,
  CONFIDENCE_THRESHOLD,
  MEMORY_DISTANCE_THRESHOLD,
} from '../services/ingestion/embeddings/src/corrections-memory';
import { embedFiles } from '../services/ingestion/embeddings/src/embed';

const baseExtraction: ExtractionResult = {
  category: 'office_supplies',
  amount_cents: 12513,
  currency: 'USD',
  txn_date: '2026-08-10',
  extracted_fields: [{ key: 'vendor', value: 'PETCO #2214' }],
};

const match = (overrides: Partial<{
  correctionId: string; transactionId: string; field: string;
  originalValue: string | null; correctedValue: string; distance: number;
}> = {}) => ({
  correctionId: 'c1', transactionId: 't1', field: 'vendor',
  originalValue: 'PETCO #2214', correctedValue: 'Petco', distance: 0,
  ...overrides,
});

beforeEach(() => {
  logAction.mockClear();
  searchCorrectionMemory.mockClear();
  invokeModel.mockClear();
  getMockExtraction.mockClear();
  insertDocument.mockClear();
  insertTransaction.mockClear();
});

describe('applyCorrectionMemory — grouping and confidence threshold', () => {
  it('applies the mapping directly once >= CONFIDENCE_THRESHOLD identical prior corrections agree', async () => {
    expect(CONFIDENCE_THRESHOLD).toBe(2); // acceptance criterion: "corrected twice" → third is automatic
    searchCorrectionMemory.mockResolvedValue([
      match({ correctionId: 'c1', transactionId: 't1', distance: 0 }),
      match({ correctionId: 'c2', transactionId: 't2', distance: 1.5 }),
    ]);

    const result = await applyCorrectionMemory('org-1', 'supply_receipt', baseExtraction, [0.1, 0.2]);

    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]).toMatchObject({
      field: 'vendor', fromValue: 'PETCO #2214', toValue: 'Petco', occurrences: 2,
    });
    expect(result.suggestions).toHaveLength(0);
    expect(result.extraction.extracted_fields).toContainEqual({ key: 'vendor', value: 'Petco' });
    // Original object is untouched — caller gets a new extraction, not a mutation.
    expect(baseExtraction.extracted_fields[0].value).toBe('PETCO #2214');
  });

  it('surfaces a suggestion instead of auto-applying when only one prior correction matches', async () => {
    searchCorrectionMemory.mockResolvedValue([match({ correctionId: 'c1', distance: 0 })]);

    const result = await applyCorrectionMemory('org-1', 'supply_receipt', baseExtraction, [0.1, 0.2]);

    expect(result.applied).toHaveLength(0);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({ field: 'vendor', occurrences: 1 });
    expect(result.extraction).toEqual(baseExtraction);
  });

  it('ignores matches beyond the distance threshold — not similar enough to count as precedent', async () => {
    searchCorrectionMemory.mockResolvedValue([
      match({ correctionId: 'c1', distance: MEMORY_DISTANCE_THRESHOLD + 0.01 }),
      match({ correctionId: 'c2', distance: MEMORY_DISTANCE_THRESHOLD + 5 }),
    ]);

    const result = await applyCorrectionMemory('org-1', 'supply_receipt', baseExtraction, [0.1]);

    expect(result.applied).toHaveLength(0);
    expect(result.suggestions).toHaveLength(0);
  });

  it('ignores corrections whose original_value does not match the current raw value — not "the same mistake"', async () => {
    searchCorrectionMemory.mockResolvedValue([
      match({ correctionId: 'c1', originalValue: 'PETCO STORE 2214' }), // different raw text
      match({ correctionId: 'c2', originalValue: 'PETCO STORE 2214' }),
    ]);

    const result = await applyCorrectionMemory('org-1', 'supply_receipt', baseExtraction, [0.1]);

    expect(result.applied).toHaveLength(0);
    expect(result.suggestions).toHaveLength(0);
  });

  it('ignores corrections with a null original_value (nothing to pattern-match against)', async () => {
    searchCorrectionMemory.mockResolvedValue([
      match({ correctionId: 'c1', originalValue: null }),
      match({ correctionId: 'c2', originalValue: null }),
    ]);

    const result = await applyCorrectionMemory('org-1', 'supply_receipt', baseExtraction, [0.1]);

    expect(result.applied).toHaveLength(0);
    expect(result.suggestions).toHaveLength(0);
  });

  it('applies to top-level fields (category, amount_cents) as well as extracted_fields keys', async () => {
    searchCorrectionMemory.mockResolvedValue([
      match({ correctionId: 'c1', field: 'category', originalValue: 'office_supplies', correctedValue: 'pet_supplies', distance: 0 }),
      match({ correctionId: 'c2', field: 'category', originalValue: 'office_supplies', correctedValue: 'pet_supplies', distance: 2 }),
      match({ correctionId: 'c3', field: 'amount_cents', originalValue: '12513', correctedValue: '12613', distance: 0 }),
      match({ correctionId: 'c4', field: 'amount_cents', originalValue: '12513', correctedValue: '12613', distance: 0 }),
    ]);

    const result = await applyCorrectionMemory('org-1', 'supply_receipt', baseExtraction, [0.1]);

    expect(result.applied).toHaveLength(2);
    expect(result.extraction.category).toBe('pet_supplies');
    expect(result.extraction.amount_cents).toBe(12613);
  });

  it('passes org_id, doc_type, and the query embedding through to the search primitive', async () => {
    searchCorrectionMemory.mockResolvedValue([]);
    await applyCorrectionMemory('org-42', 'vet_invoice', baseExtraction, [0.5, 0.6], { k: 7 });
    expect(searchCorrectionMemory).toHaveBeenCalledWith('org-42', 'vet_invoice', [0.5, 0.6], 7);
  });
});

// ── End-to-end: the embed.ts extraction pipeline, C3 acceptance criterion ──
describe('embedFiles — correction memory wired into the extraction pipeline', () => {
  it('after two prior identical corrections, the third similar document is extracted correctly without volunteer input, and the adjustment is audited distinctly from a fresh extraction', async () => {
    // "before": what the extractor produces on its own — the same mistake
    // this org already fixed twice (vendor "PETCO #2214" → "Petco").
    getMockExtraction.mockReturnValue({
      category: 'office_supplies',
      amount_cents: 12513,
      currency: 'USD',
      txn_date: '2026-08-10',
      extracted_fields: [{ key: 'vendor', value: 'PETCO #2214' }],
    });

    // Two prior corrections for this org/doc_type, both correcting the exact
    // same field/value, on transactions that resemble this document.
    searchCorrectionMemory.mockResolvedValue([
      match({ correctionId: 'corr-1', transactionId: 'txn-1', distance: 0 }),
      match({ correctionId: 'corr-2', transactionId: 'txn-2', distance: 1.2 }),
    ]);

    insertDocument.mockResolvedValue({
      id: 'doc-3', org_id: 'org-1', s3_key: 'local/petco-receipt-aug.txt',
      doc_type: 'supply_receipt', status: 'approved', uploaded_by: 'cli-system',
      created_at: new Date().toISOString(),
    });
    insertTransaction.mockImplementation(async (documentId: string, extraction: ExtractionResult, embedding: number[]) => ({
      id: 'txn-3', org_id: 'org-1', document_id: documentId,
      category: extraction.category, amount_cents: extraction.amount_cents,
      currency: extraction.currency, txn_date: extraction.txn_date,
      extracted_fields_json: extraction.extracted_fields, embedding,
      status: 'pending_review', created_at: new Date().toISOString(),
    }));

    const [txn] = await embedFiles(['demo-data/petco-receipt-aug.txt'], 'supply_receipt');

    // Acceptance criterion, literally: extracted correctly, no volunteer input.
    const vendorField = (txn.extracted_fields_json as { key: string; value: string }[])
      .find((f) => f.key === 'vendor');
    expect(vendorField?.value).toBe('Petco');

    // The corrected value is what actually got persisted (insertTransaction
    // was called with the already-adjusted extraction), not the raw mistake.
    expect(insertTransaction).toHaveBeenCalledWith(
      'doc-3',
      expect.objectContaining({
        extracted_fields: expect.arrayContaining([{ key: 'vendor', value: 'Petco' }]),
      }),
      expect.any(Array),
    );

    // Distinct audit trail: the routine extraction log still fires (flagged
    // memory_adjusted: true)...
    expect(logAction).toHaveBeenCalledWith(
      'org-1', 'cli-system', 'fields_extracted', 'transactions', 'txn-3',
      expect.objectContaining({ memory_adjusted: true }),
    );
    // ...and a *separate*, distinctly-typed action records the memory-driven
    // adjustment itself, with enough detail for a before/after demo.
    expect(logAction).toHaveBeenCalledWith(
      'org-1', 'cli-system', 'extraction_adjusted_from_memory', 'transactions', 'txn-3',
      expect.objectContaining({
        before: { fields: [{ field: 'vendor', value: 'PETCO #2214' }] },
        after: { fields: [{ field: 'vendor', value: 'Petco' }] },
        adjustments: expect.arrayContaining([
          expect.objectContaining({ field: 'vendor', occurrences: 2 }),
        ]),
      }),
    );
    // No suggestion log when the adjustment was confidently applied.
    expect(logAction).not.toHaveBeenCalledWith(
      'org-1', 'cli-system', 'extraction_memory_suggested', 'transactions', 'txn-3', expect.anything(),
    );
  });

  it('with only one prior correction, extraction is left as-is and a suggestion is logged instead of an applied adjustment', async () => {
    getMockExtraction.mockReturnValue({
      category: 'office_supplies',
      amount_cents: 12513,
      currency: 'USD',
      txn_date: '2026-08-10',
      extracted_fields: [{ key: 'vendor', value: 'PETCO #2214' }],
    });
    searchCorrectionMemory.mockResolvedValue([match({ correctionId: 'corr-1', distance: 0 })]);
    insertDocument.mockResolvedValue({
      id: 'doc-1', org_id: 'org-1', s3_key: 'local/petco-receipt-jun.txt',
      doc_type: 'supply_receipt', status: 'approved', uploaded_by: 'cli-system',
      created_at: new Date().toISOString(),
    });
    insertTransaction.mockImplementation(async (documentId: string, extraction: ExtractionResult, embedding: number[]) => ({
      id: 'txn-1', org_id: 'org-1', document_id: documentId,
      category: extraction.category, amount_cents: extraction.amount_cents,
      currency: extraction.currency, txn_date: extraction.txn_date,
      extracted_fields_json: extraction.extracted_fields, embedding,
      status: 'pending_review', created_at: new Date().toISOString(),
    }));

    const [txn] = await embedFiles(['demo-data/petco-receipt-jun.txt'], 'supply_receipt');

    const vendorField = (txn.extracted_fields_json as { key: string; value: string }[])
      .find((f) => f.key === 'vendor');
    expect(vendorField?.value).toBe('PETCO #2214'); // unchanged — only one prior correction, not a confident pattern yet

    expect(logAction).not.toHaveBeenCalledWith(
      'org-1', 'cli-system', 'extraction_adjusted_from_memory', expect.anything(), expect.anything(), expect.anything(),
    );
    expect(logAction).toHaveBeenCalledWith(
      'org-1', 'cli-system', 'extraction_memory_suggested', 'transactions', 'txn-1',
      expect.objectContaining({
        suggestions: expect.arrayContaining([expect.objectContaining({ field: 'vendor', occurrences: 1 })]),
      }),
    );
  });
});
