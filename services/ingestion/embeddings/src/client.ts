// DB client + Bedrock abstraction for the embeddings module.
// Mirrors B2's client.ts pattern: IS_MOCK detection, FISCUS_MOCK_DB setup, real pg pool.

import path from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import pg from 'pg';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type {
  DocumentRow, TransactionRow, SearchResult, ExtractionResult,
  TemplateRow, TemplateSearchResult,
} from './types';

const { Pool } = pg;

export const MODULE_ROOT = path.resolve(__dirname, '..');
export const MOCK_DB_PATH = path.resolve(MODULE_ROOT, 'fixtures', 'mock-db.json');
process.env.FISCUS_MOCK_DB = MOCK_DB_PATH;

const DB_URL = process.env.DATABASE_URL ?? process.env.COCKROACH_DATABASE_URL;
const HAS_AWS = !!(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE);
export const IS_MOCK = !DB_URL || !HAS_AWS;

const BEDROCK_MODEL = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-3-5-haiku-20241022-v1:0';
export const ORG_ID = '00000000-0000-0000-0000-000000000001';

// ── Mock extraction fixtures keyed by doc_type ────────────────────────────────
const MOCK_EXTRACTIONS: Record<string, ExtractionResult> = {
  vet_invoice: {
    category: 'veterinary',
    amount_cents: 24469,
    currency: 'USD',
    txn_date: '2024-07-15',
    extracted_fields: [
      { key: 'invoice_number', value: 'INV-240715' },
      { key: 'vendor', value: 'Paws & Claws Veterinary Clinic' },
      { key: 'patient', value: 'Biscuit' },
    ],
  },
  donation_receipt: {
    category: 'donations',
    amount_cents: 50000,
    currency: 'USD',
    txn_date: '2024-06-01',
    extracted_fields: [
      { key: 'receipt_number', value: 'DON-240601' },
      { key: 'donor', value: 'Springfield Area United Nonprofits' },
    ],
  },
  supply_receipt: {
    category: 'office_supplies',
    amount_cents: 8750,
    currency: 'USD',
    txn_date: '2024-06-10',
    extracted_fields: [
      { key: 'receipt_number', value: 'RCP-240610' },
      { key: 'vendor', value: 'Office Depot' },
    ],
  },
};

export function getMockExtraction(docType: string): ExtractionResult {
  return MOCK_EXTRACTIONS[docType] ?? {
    category: 'other',
    amount_cents: 0,
    currency: 'USD',
    txn_date: new Date().toISOString().slice(0, 10),
    extracted_fields: [],
  };
}

// ── Bedrock ───────────────────────────────────────────────────────────────────
export async function invokeModel(systemPrompt: string, userPrompt: string): Promise<string> {
  if (IS_MOCK) {
    throw new Error('invokeModel called in mock mode — caller should use getMockExtraction instead');
  }
  const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
  const resp = await client.send(new ConverseCommand({
    modelId: BEDROCK_MODEL,
    system: [{ text: systemPrompt }],
    messages: [{ role: 'user', content: [{ text: userPrompt }] }],
    inferenceConfig: { maxTokens: 1024, temperature: 0 },
  }));
  const block = resp.output?.message?.content?.[0];
  // The AWS SDK's ContentBlock union has no `type` discriminant field, so
  // `block.type !== 'text'` doesn't compile under strict mode -- narrow with
  // an `in` check instead (same fix already applied to the other three
  // Bedrock client.ts files this week, see CLAUDE.md Learnings).
  if (!block || !('text' in block) || !block.text) {
    throw new Error('Bedrock returned no text content');
  }
  return block.text;
}

// ── Mock DB ───────────────────────────────────────────────────────────────────
interface MockDb {
  documents: DocumentRow[];
  transactions: TransactionRow[];
  templates: TemplateRow[];
  audit_log: unknown[];
}

function readMockDb(): MockDb {
  if (!existsSync(MOCK_DB_PATH)) return { documents: [], transactions: [], templates: [], audit_log: [] };
  const db = JSON.parse(readFileSync(MOCK_DB_PATH, 'utf-8')) as Partial<MockDb>;
  // Older fixture snapshots predate the `templates` array — default it rather
  // than throwing, so this doesn't break existing fixtures.
  return { documents: [], transactions: [], templates: [], audit_log: [], ...db };
}

// ── Vector distance (mock mode only) ────────────────────────────────────────────
// Mirrors CockroachDB's `<->` operator (L2/Euclidean distance, vector_l2_ops —
// see the VECTOR INDEX definitions in db/migrations/004 and docs/schema.md)
// so mock-mode ranking and anomaly thresholds behave like real mode, instead of
// the previous placeholder that just returned insertion order.
export function l2Distance(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function writeMockDb(db: MockDb): void {
  writeFileSync(MOCK_DB_PATH, JSON.stringify(db, null, 2));
}

// ── Real DB pool ──────────────────────────────────────────────────────────────
let _pool: InstanceType<typeof Pool> | null = null;
function getPool(): InstanceType<typeof Pool> {
  if (!_pool) _pool = new Pool({ connectionString: DB_URL! });
  return _pool;
}

// ── DB operations ─────────────────────────────────────────────────────────────
export async function insertDocument(
  s3Key: string,
  docType: string,
): Promise<DocumentRow> {
  if (IS_MOCK) {
    const db = readMockDb();
    const row: DocumentRow = {
      id: randomUUID(),
      org_id: ORG_ID,
      s3_key: s3Key,
      doc_type: docType,
      status: 'approved',
      uploaded_by: 'cli-system',
      created_at: new Date().toISOString(),
    };
    db.documents.push(row);
    writeMockDb(db);
    return row;
  }
  const result = await getPool().query<DocumentRow>(
    `INSERT INTO documents (org_id, s3_key, doc_type, status, uploaded_by)
     VALUES ($1,$2,$3,'approved','cli-system') RETURNING *`,
    [ORG_ID, s3Key, docType],
  );
  return result.rows[0];
}

export async function insertTransaction(
  documentId: string,
  extraction: ExtractionResult,
  embedding: number[],
): Promise<TransactionRow> {
  if (IS_MOCK) {
    const db = readMockDb();
    const row: TransactionRow = {
      id: randomUUID(),
      org_id: ORG_ID,
      document_id: documentId,
      category: extraction.category,
      amount_cents: extraction.amount_cents,
      currency: extraction.currency,
      txn_date: extraction.txn_date,
      extracted_fields_json: extraction.extracted_fields,
      embedding,
      status: 'pending_review',
      created_at: new Date().toISOString(),
    };
    db.transactions.push(row);
    writeMockDb(db);
    return row;
  }
  const result = await getPool().query<TransactionRow>(
    `INSERT INTO transactions
       (org_id, document_id, category, amount_cents, currency, txn_date, extracted_fields_json, embedding, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending_review') RETURNING *`,
    [
      ORG_ID, documentId, extraction.category, extraction.amount_cents,
      extraction.currency, extraction.txn_date,
      JSON.stringify(extraction.extracted_fields), JSON.stringify(embedding),
    ],
  );
  return result.rows[0];
}

export interface SearchOpts {
  /** Exclude a transaction by id — used for nearest-neighbor/anomaly checks so a
   * transaction never counts itself as its own nearest neighbor. */
  excludeId?: string;
}

export async function searchTransactions(
  queryEmbedding: number[],
  limit = 5,
  opts: SearchOpts = {},
): Promise<SearchResult[]> {
  if (IS_MOCK) {
    const db = readMockDb();
    // Mock: rank by real L2 distance against each stored embedding, same
    // vector_l2_ops semantics as CockroachDB's `<->` in real mode below —
    // previously this just returned insertion order with a fake distance.
    return db.transactions
      .filter((t) => t.id !== opts.excludeId)
      .map((t) => ({
        id: t.id,
        category: t.category,
        amount_cents: t.amount_cents,
        txn_date: t.txn_date,
        distance: l2Distance(queryEmbedding, t.embedding),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
  }
  const params: unknown[] = [JSON.stringify(queryEmbedding), ORG_ID, limit];
  let excludeClause = '';
  if (opts.excludeId) {
    params.push(opts.excludeId);
    excludeClause = `AND id != $${params.length}`;
  }
  const result = await getPool().query<SearchResult>(
    `SELECT id, category, amount_cents, txn_date,
            embedding <-> $1 AS distance
     FROM transactions
     WHERE org_id = $2 ${excludeClause}
     ORDER BY embedding <-> $1
     LIMIT $3`,
    params,
  );
  return result.rows;
}

export async function updateTransactionStatus(id: string, status: string): Promise<void> {
  if (IS_MOCK) {
    const db = readMockDb();
    const row = db.transactions.find((t) => t.id === id);
    if (row) {
      row.status = status;
      writeMockDb(db);
    }
    return;
  }
  await getPool().query(`UPDATE transactions SET status = $2 WHERE id = $1`, [id, status]);
}

// ── Template search (B3: "which template does this look like?") ────────────────
export async function searchTemplates(
  queryEmbedding: number[],
  limit = 5,
): Promise<TemplateSearchResult[]> {
  if (IS_MOCK) {
    const db = readMockDb();
    return db.templates
      .map((t) => ({
        id: t.id,
        form_type: t.form_type,
        status: t.status,
        distance: l2Distance(queryEmbedding, t.embedding),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
  }
  const result = await getPool().query<TemplateSearchResult>(
    `SELECT id, form_type, status, embedding <-> $1 AS distance
     FROM templates
     WHERE org_id = $2
     ORDER BY embedding <-> $1
     LIMIT $3`,
    [JSON.stringify(queryEmbedding), ORG_ID, limit],
  );
  return result.rows;
}
