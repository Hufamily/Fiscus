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
  document_id: string;
  category: string;
  amount_cents: number;
  txn_date: string;
  distance: number;
}
