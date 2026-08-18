// DB client + Bedrock for the s3-extraction module.
// Mirrors the other services/ingestion/*/src/client.ts modules: IS_MOCK
// detection, FISCUS_MOCK_DB, real pg pool — so this module is testable the
// same way as embeddings/template-gen, unlike the Python original it
// replaces (which had no local/mock mode at all, only a deployed Lambda).

import path from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import pg from 'pg';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const { Pool } = pg;

export const MODULE_ROOT = path.resolve(__dirname, '..');
export const MOCK_DB_PATH = path.resolve(MODULE_ROOT, 'fixtures', 'mock-db.json');
process.env.FISCUS_MOCK_DB = MOCK_DB_PATH;

const DB_URL = process.env.DATABASE_URL ?? process.env.COCKROACH_DATABASE_URL;
export const IS_MOCK = !DB_URL;

export const SYSTEM_ACTOR = 's3-lambda-bedrock';

// ── Bedrock ───────────────────────────────────────────────────────────────
export interface ConverseBlock {
  text?: string;
  document?: { format: string; name: string; source: { bytes: Uint8Array } };
  image?: { format: string; source: { bytes: Uint8Array } };
}

export async function converse(region: string, modelId: string, blocks: ConverseBlock[]): Promise<string> {
  const client = new BedrockRuntimeClient({ region });
  const resp = await client.send(new ConverseCommand({
    modelId,
    messages: [{ role: 'user', content: blocks }],
    inferenceConfig: { maxTokens: 2000, temperature: 0 },
  }));
  const block = resp.output?.message?.content?.[0];
  if (!block || block.type !== 'text' || !block.text) {
    throw new Error('Bedrock returned no extraction text');
  }
  return block.text;
}

// ── Mock DB ───────────────────────────────────────────────────────────────
export interface MockDocument {
  id: string;
  org_id: string;
  s3_key: string;
  doc_type: string;
  status: string;
  uploaded_by: string;
  [key: string]: unknown;
}

export interface MockTransaction {
  id: string;
  org_id: string;
  document_id: string;
  category: string;
  amount_cents: number;
  currency: string;
  txn_date: string;
  extracted_fields_json: unknown;
  status: string;
  [key: string]: unknown;
}

export interface MockDb {
  documents: MockDocument[];
  transactions: MockTransaction[];
  audit_log: unknown[];
  [key: string]: unknown;
}

export function readMockDb(): MockDb {
  if (!existsSync(MOCK_DB_PATH)) {
    return { documents: [], transactions: [], audit_log: [] };
  }
  return JSON.parse(readFileSync(MOCK_DB_PATH, 'utf-8')) as MockDb;
}

export function writeMockDb(db: MockDb): void {
  writeFileSync(MOCK_DB_PATH, JSON.stringify(db, null, 2));
}

// ── Real DB pool ──────────────────────────────────────────────────────────
let _pool: InstanceType<typeof Pool> | null = null;
export function getPool(): InstanceType<typeof Pool> {
  if (!_pool) _pool = new Pool({ connectionString: DB_URL! });
  return _pool;
}
