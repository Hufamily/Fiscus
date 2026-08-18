// DB client + Bedrock for the exec-summaries module.
// Mirrors B1/C1 client.ts: IS_MOCK detection, FISCUS_MOCK_DB, real pg pool.

import path from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import pg from 'pg';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { SummaryRow, AggregateRow } from './types';

const { Pool } = pg;

export const MODULE_ROOT = path.resolve(__dirname, '..');
export const MOCK_DB_PATH = path.resolve(MODULE_ROOT, 'fixtures', 'mock-db.json');
process.env.FISCUS_MOCK_DB = MOCK_DB_PATH;

const DB_URL = process.env.DATABASE_URL ?? process.env.COCKROACH_DATABASE_URL;
const HAS_AWS = !!(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE);
export const IS_MOCK = !DB_URL || !HAS_AWS;

const BEDROCK_MODEL = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-3-5-haiku-20241022-v1:0';
export const ORG_ID = '00000000-0000-0000-0000-000000000001';
export const ACTOR_ID = 'cli-system';

// ── Bedrock ───────────────────────────────────────────────────────────────────
export async function invokeModel(systemPrompt: string, userPrompt: string): Promise<string> {
  const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
  const resp = await client.send(new ConverseCommand({
    modelId: BEDROCK_MODEL,
    system: [{ text: systemPrompt }],
    messages: [{ role: 'user', content: [{ text: userPrompt }] }],
    inferenceConfig: { maxTokens: 512, temperature: 0 },
  }));
  const block = resp.output?.message?.content?.[0];
  // The AWS SDK's ContentBlock union has no `type` discriminant field, so
  // `block.type !== 'text'` doesn't compile under strict mode -- narrow with
  // an `in` check instead.
  if (!block || !('text' in block) || !block.text) {
    throw new Error('Bedrock returned no text content');
  }
  return block.text;
}

// ── Mock DB ───────────────────────────────────────────────────────────────────
interface MockTransaction {
  org_id: string;
  category: string;
  amount_cents: number;
  status: string;
  [key: string]: unknown;
}

interface MockDb {
  documents: unknown[];
  transactions: MockTransaction[];
  summaries: SummaryRow[];
  audit_log: unknown[];
}

function readMockDb(): MockDb {
  if (!existsSync(MOCK_DB_PATH)) {
    return { documents: [], transactions: [], summaries: [], audit_log: [] };
  }
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

// ── Aggregate-only query (RBAC: no row-level SELECT) ─────────────────────────
export async function getAggregates(): Promise<AggregateRow[]> {
  if (IS_MOCK) {
    const db = readMockDb();
    const map = new Map<string, AggregateRow>();
    for (const t of db.transactions) {
      const key = `${t.category}::${t.status}`;
      const existing = map.get(key);
      if (existing) {
        existing.total_cents += t.amount_cents;
        existing.count += 1;
      } else {
        map.set(key, {
          category: t.category,
          status: t.status,
          total_cents: t.amount_cents,
          count: 1,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.total_cents - a.total_cents);
  }
  // Aggregate-only: no individual row data crosses the query boundary (AGENTS.md §5 RBAC).
  const result = await getPool().query<AggregateRow>(
    `SELECT category, status,
            SUM(amount_cents)::int AS total_cents,
            COUNT(*)::int          AS count
     FROM transactions
     WHERE org_id = $1
     GROUP BY category, status
     ORDER BY SUM(amount_cents) DESC`,
    [ORG_ID],
  );
  return result.rows;
}

// ── Insert summary ────────────────────────────────────────────────────────────
export async function insertSummary(
  periodLabel: string,
  body: string,
): Promise<SummaryRow> {
  if (IS_MOCK) {
    const db = readMockDb();
    const row: SummaryRow = {
      id: randomUUID(),
      org_id: ORG_ID,
      period_label: periodLabel,
      body,
      created_at: new Date().toISOString(),
    };
    db.summaries.push(row);
    writeMockDb(db);
    return row;
  }
  const result = await getPool().query<SummaryRow>(
    `INSERT INTO summaries (org_id, period_label, body)
     VALUES ($1,$2,$3) RETURNING *`,
    [ORG_ID, periodLabel, body],
  );
  return result.rows[0];
}
