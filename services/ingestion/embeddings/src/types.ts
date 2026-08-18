import { z } from 'zod';

// ── Zod schema for Bedrock extraction output ──────────────────────────────────
export const ExtractionSchema = z.object({
  category: z.string().min(1),
  amount_cents: z.number().int().nonnegative(),
  currency: z.string().default('USD'),
  txn_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  extracted_fields: z.array(z.object({ key: z.string(), value: z.string() })),
});

export type ExtractionResult = z.infer<typeof ExtractionSchema>;

// ── Row shapes (match AGENTS.md §4) ──────────────────────────────────────────
export interface DocumentRow {
  id: string;
  org_id: string;
  s3_key: string;
  doc_type: string;
  status: string;
  uploaded_by: string;
  created_at: string;
}

export interface TransactionRow {
  id: string;
  org_id: string;
  document_id: string;
  category: string;
  amount_cents: number;
  currency: string;
  txn_date: string;
  extracted_fields_json: ExtractionResult['extracted_fields'];
  embedding: number[];
  status: string;
  created_at: string;
}

export interface SearchResult {
  id: string;
  category: string;
  amount_cents: number;
  txn_date: string;
  distance: number;
}

// ── templates (owned by Track B — form_type/schema/embedding, see AGENTS.md §4) ─
export interface TemplateRow {
  id: string;
  org_id: string;
  form_type: string;
  schema_json: unknown;
  embedding: number[];
  status: string;
  created_at: string;
}

export interface TemplateSearchResult {
  id: string;
  form_type: string;
  status: string;
  distance: number;
}

// ── corrections (owned by Track C — "learned memory" table, see AGENTS.md §4) ──
// doc_type is intentionally not a column here — joined via transaction_id ->
// transactions.document_id -> documents.doc_type, per AGENTS.md §4/§6.
export interface CorrectionRow {
  id: string;
  org_id: string;
  transaction_id: string;
  field: string;
  original_value: string | null;
  corrected_value: string;
  corrected_by: string;
  created_at: string;
}

/** A past correction whose transaction resembles the document currently being
 * extracted, ranked by the same L2 distance semantics as searchTransactions. */
export interface CorrectionMemoryMatch {
  correctionId: string;
  transactionId: string;
  field: string;
  originalValue: string | null;
  correctedValue: string;
  distance: number;
}
