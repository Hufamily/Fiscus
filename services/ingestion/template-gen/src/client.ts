// DB client abstraction: real (pg / CockroachDB) vs mock (mock-db.json).
// Sets FISCUS_MOCK_DB env var so lib/audit.ts knows where to write mock rows.

import path from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import pg from 'pg';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { TemplateRow, SchemaJson } from './types';

const { Pool } = pg;

export const MODULE_ROOT = path.resolve(__dirname, '..');

export const MOCK_DB_PATH = path.resolve(MODULE_ROOT, 'fixtures', 'mock-db.json');

// Set env var so lib/audit.ts resolves mock-db.json to the right path.
process.env.FISCUS_MOCK_DB = MOCK_DB_PATH;

const DB_URL = process.env.DATABASE_URL ?? process.env.COCKROACH_DATABASE_URL;
const HAS_AWS = !!(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE);
export const IS_MOCK = !DB_URL || !HAS_AWS;

const BEDROCK_MODEL = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

export const ORG_ID = '00000000-0000-0000-0000-000000000001';

// ── Mock call counter for testing Zod-retry path ──────────────────────────────
let _mockBedrockCalls: Record<string, number> = {};

const MOCK_SCHEMA: SchemaJson = [
  { key: 'invoice_number', label: 'Invoice Number', type: 'string', expected_pattern: 'INV-\\d{6}', sample: 'INV-240715' },
  { key: 'invoice_date',   label: 'Invoice Date',   type: 'date',   expected_pattern: 'MM/DD/YYYY',    sample: '07/15/2024' },
  { key: 'total_amount',   label: 'Total Amount',   type: 'amount', expected_pattern: '\\$[\\d,]+\\.\\d{2}', sample: '$244.69' },
  { key: 'payment_method', label: 'Payment Method', type: 'category', sample: 'Credit Card' },
  { key: 'vendor_name',    label: 'Vendor Name',    type: 'string', sample: 'Paws & Claws Veterinary Clinic' },
];

// ── Bedrock client ─────────────────────────────────────────────────────────────

export async function invokeModel(systemPrompt: string, userPrompt: string, formType?: string): Promise<string> {
  if (IS_MOCK) {
    const ft = formType ?? '__default__';
    _mockBedrockCalls[ft] = (_mockBedrockCalls[ft] ?? 0) + 1;

    if (ft === '__always_bad__') return 'NOT_JSON_AT_ALL';
    if (ft === '__bad_first__' && _mockBedrockCalls[ft] === 1) return 'INVALID_JSON_ON_FIRST_CALL';

    return JSON.stringify(MOCK_SCHEMA);
  }

  const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
  const resp = await client.send(new ConverseCommand({
    modelId: BEDROCK_MODEL,
    system: [{ text: systemPrompt }],
    messages: [{ role: 'user', content: [{ text: userPrompt }] }],
    inferenceConfig: { maxTokens: 4096, temperature: 0 },
  }));

  const block = resp.output?.message?.content?.[0];
  if (!block || !('text' in block) || !block.text) {
    throw new Error('Bedrock returned no text content');
  }
  return block.text;
}

// ── DB client ──────────────────────────────────────────────────────────────────

interface MockDb {
  templates: TemplateRow[];
  audit_log: unknown[];
}

function readMockDb(): MockDb {
  if (!existsSync(MOCK_DB_PATH)) return { templates: [], audit_log: [] };
  return JSON.parse(readFileSync(MOCK_DB_PATH, 'utf-8')) as MockDb;
}

function writeMockDb(db: MockDb): void {
  writeFileSync(MOCK_DB_PATH, JSON.stringify(db, null, 2));
}

let _pool: InstanceType<typeof Pool> | null = null;
function getPool(): InstanceType<typeof Pool> {
  if (!_pool) _pool = new Pool({ connectionString: DB_URL! });
  return _pool;
}

export async function insertTemplate(
  formType: string,
  schemaJson: SchemaJson,
  embedding: number[],
): Promise<TemplateRow> {
  if (IS_MOCK) {
    const db = readMockDb();
    const row: TemplateRow = {
      id: randomUUID(),
      org_id: ORG_ID,
      form_type: formType,
      schema_json: schemaJson,
      embedding,
      status: 'pending_review',
      created_at: new Date().toISOString(),
    };
    db.templates.push(row);
    writeMockDb(db);
    return row;
  }

  const result = await getPool().query<TemplateRow>(
    `INSERT INTO templates (org_id, form_type, schema_json, embedding, status)
     VALUES ($1,$2,$3,$4,'pending_review') RETURNING *`,
    [ORG_ID, formType, JSON.stringify(schemaJson), JSON.stringify(embedding)],
  );
  return result.rows[0];
}

export async function getTemplate(id: string): Promise<TemplateRow | null> {
  if (IS_MOCK) {
    return readMockDb().templates.find((t) => t.id === id) ?? null;
  }
  const result = await getPool().query<TemplateRow>('SELECT * FROM templates WHERE id=$1', [id]);
  return result.rows[0] ?? null;
}

export async function setTemplateApproved(id: string): Promise<TemplateRow> {
  if (IS_MOCK) {
    const db = readMockDb();
    const idx = db.templates.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error(`Template ${id} not found`);
    db.templates[idx].status = 'approved';
    writeMockDb(db);
    return db.templates[idx];
  }

  const result = await getPool().query<TemplateRow>(
    `UPDATE templates SET status='approved' WHERE id=$1 RETURNING *`,
    [id],
  );
  if (result.rows.length === 0) throw new Error(`Template ${id} not found`);
  return result.rows[0];
}
