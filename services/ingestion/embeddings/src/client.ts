// DB client + Bedrock abstraction for the embeddings module.
// Mirrors B2's client.ts pattern: IS_MOCK detection, FISCUS_MOCK_DB setup, real pg pool.

import path from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import pg from 'pg';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { DocumentRow, TransactionRow, SearchResult, ExtractionResult } from './types';

const { Pool } = pg;

export const MODULE_ROOT = path.resolve(__dirname, '..');
export const MOCK_DB_PATH = path.resolve(MODULE_ROOT, 'fixtures', 'mock-db.json');
process.env.FISCUS_MOCK_DB = MOCK_DB_PATH;

const DB_URL = process.env.DATABASE_URL ?? process.env.COCKROACH_DATABASE_URL;
const HAS_AWS = !!(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE);
export const IS_MOCK = !DB_URL || !HAS_AWS;

const BEDROCK_MODEL = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
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
  if (!block || !('text' in block) || !block.text) {
    throw new Error('Bedrock returned no text content');
  }
  return block.text;
}

// ── Mock DB ───────────────────────────────────────────────────────────────────
interface MockDb {
  documents: DocumentRow[];
  transactions: TransactionRow[];
  audit_log: unknown[];
}

function readMockDb(): MockDb {
  if (!existsSync(MOCK_DB_PATH)) return { documents: [], transactions: [], audit_log: [] };
  return JSON.parse(readFileSync(MOCK_DB_PATH, 'utf-8')) as MockDb;
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

export async function searchTransactions(queryEmbedding: number[], limit = 5): Promise<SearchResult[]> {
  if (IS_MOCK) {
    const db = readMockDb();
    // Mock: return stored transactions in insertion order with mock distances.
    // Real mode uses cosine distance (<->). Documented in README.
    return db.transactions.slice(0, limit).map((t, i) => ({
      id: t.id,
      category: t.category,
      amount_cents: t.amount_cents,
      txn_date: t.txn_date,
      distance: parseFloat((0.10 + i * 0.15).toFixed(2)),
    }));
  }
  const result = await getPool().query<SearchResult>(
    `SELECT id, category, amount_cents, txn_date,
            embedding <-> $1 AS distance
     FROM transactions
     WHERE org_id = $2
     ORDER BY embedding <-> $1
     LIMIT $3`,
    [JSON.stringify(queryEmbedding), ORG_ID, limit],
  );
  return result.rows;
}
