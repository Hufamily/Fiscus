// DB client + Bedrock abstraction for the volunteer agent module.
// Mirrors B1/B2 client.ts: IS_MOCK detection, FISCUS_MOCK_DB, real pg pool.

import path from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import pg from 'pg';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { SessionRow, AggregateRow, TransactionSummary } from './types';

const { Pool } = pg;

export const MODULE_ROOT = path.resolve(__dirname, '..');
export const MOCK_DB_PATH = path.resolve(MODULE_ROOT, 'fixtures', 'mock-db.json');
process.env.FISCUS_MOCK_DB = MOCK_DB_PATH;

const DB_URL = process.env.DATABASE_URL ?? process.env.COCKROACH_DATABASE_URL;
const HAS_AWS = !!(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE);
export const IS_MOCK = !DB_URL || !HAS_AWS;

const BEDROCK_MODEL = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-3-5-haiku-20241022-v1:0';
export const ORG_ID = '00000000-0000-0000-0000-000000000001';
export const VOLUNTEER_ID = 'cli-volunteer';

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
  id: string;
  org_id: string;
  category: string;
  amount_cents: number;
  txn_date: string;
  status: string;
  [key: string]: unknown;
}

interface MockDb {
  documents: unknown[];
  transactions: MockTransaction[];
  sessions: SessionRow[];
  audit_log: unknown[];
}

function readMockDb(): MockDb {
  if (!existsSync(MOCK_DB_PATH)) {
    return { documents: [], transactions: [], sessions: [], audit_log: [] };
  }
  return JSON.parse(readFileSync(MOCK_DB_PATH, 'utf-8')) as MockDb;
}

export function writeMockDb(db: MockDb): void {
  writeFileSync(MOCK_DB_PATH, JSON.stringify(db, null, 2));
}

// ── Real DB pool ──────────────────────────────────────────────────────────────
let _pool: InstanceType<typeof Pool> | null = null;
function getPool(): InstanceType<typeof Pool> {
  if (!_pool) _pool = new Pool({ connectionString: DB_URL! });
  return _pool;
}

// ── Aggregates ────────────────────────────────────────────────────────────────
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
    return Array.from(map.values());
  }
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

// ── Similar transactions ──────────────────────────────────────────────────────
export async function getSimilarTransactions(
  queryEmbedding: number[],
  limit = 3,
): Promise<TransactionSummary[]> {
  if (IS_MOCK) {
    const db = readMockDb();
    return db.transactions.slice(0, limit).map((t) => ({
      id: t.id,
      category: t.category,
      amount_cents: t.amount_cents,
      txn_date: t.txn_date,
      status: t.status,
    }));
  }
  const result = await getPool().query<TransactionSummary>(
    `SELECT id, category, amount_cents, txn_date, status
     FROM transactions
     WHERE org_id = $1
     ORDER BY embedding <-> $2
     LIMIT $3`,
    [ORG_ID, JSON.stringify(queryEmbedding), limit],
  );
  return result.rows;
}

// ── Session CRUD ──────────────────────────────────────────────────────────────
export async function getSession(sessionId: string): Promise<SessionRow | null> {
  if (IS_MOCK) {
    const db = readMockDb();
    return db.sessions.find((s) => s.id === sessionId) ?? null;
  }
  const result = await getPool().query<SessionRow>(
    `SELECT * FROM sessions WHERE id = $1 AND org_id = $2`,
    [sessionId, ORG_ID],
  );
  return result.rows[0] ?? null;
}

export async function upsertSession(
  sessionId: string | undefined,
  pendingDocuments: SessionRow['pending_documents'],
): Promise<SessionRow> {
  if (IS_MOCK) {
    const db = readMockDb();
    const existing = sessionId ? db.sessions.find((s) => s.id === sessionId) : undefined;
    if (existing) {
      existing.pending_documents = pendingDocuments;
      existing.updated_at = new Date().toISOString();
      writeMockDb(db);
      return existing;
    }
    const row: SessionRow = {
      id: randomUUID(),
      org_id: ORG_ID,
      volunteer_id: VOLUNTEER_ID,
      pending_documents: pendingDocuments,
      current_index: 0,
      // Chat sessions created here have no batch attached; batch state is
      // exclusively owned by the functions below.
      batch_document_ids: [],
      batch_status: 'idle',
      updated_at: new Date().toISOString(),
    };
    db.sessions.push(row);
    writeMockDb(db);
    return row;
  }
  const id = sessionId ?? randomUUID();
  const result = await getPool().query<SessionRow>(
    `INSERT INTO sessions (id, org_id, volunteer_id, pending_documents, current_index)
     VALUES ($1,$2,$3,$4,0)
     ON CONFLICT (id) DO UPDATE
       SET pending_documents = EXCLUDED.pending_documents,
           updated_at        = now()
     RETURNING *`,
    [id, ORG_ID, VOLUNTEER_ID, JSON.stringify(pendingDocuments)],
  );
  return result.rows[0];
}

// ── Batch-resume session CRUD (C2) ──────────────────────────────────────────
// Separate from getSession/upsertSession above, which serve C1's Q&A
// conversation history via `pending_documents`. This reads/writes the
// dedicated `batch_document_ids` / `batch_status` columns added by
// 006_c2_batch_resume.sql, plus `current_index` (pre-existing but unused
// until now). See services/agent/src/batch-session.ts for the state machine
// built on top of these.

export async function getOpenBatchSession(orgId: string, volunteerId: string): Promise<SessionRow | null> {
  if (IS_MOCK) {
    const db = readMockDb();
    const matches = db.sessions
      .filter((s) => s.org_id === orgId && s.volunteer_id === volunteerId && s.batch_status === 'in_progress')
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    return matches[0] ?? null;
  }
  const result = await getPool().query<SessionRow>(
    `SELECT * FROM sessions
     WHERE org_id = $1 AND volunteer_id = $2 AND batch_status = 'in_progress'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [orgId, volunteerId],
  );
  return result.rows[0] ?? null;
}

export async function createBatchSession(
  orgId: string,
  volunteerId: string,
  documentIds: string[],
): Promise<SessionRow> {
  const status: SessionRow['batch_status'] = documentIds.length > 0 ? 'in_progress' : 'completed';
  if (IS_MOCK) {
    const db = readMockDb();
    const row: SessionRow = {
      id: randomUUID(),
      org_id: orgId,
      volunteer_id: volunteerId,
      pending_documents: {},
      current_index: 0,
      batch_document_ids: documentIds,
      batch_status: status,
      updated_at: new Date().toISOString(),
    };
    db.sessions.push(row);
    writeMockDb(db);
    return row;
  }
  const result = await getPool().query<SessionRow>(
    `INSERT INTO sessions (id, org_id, volunteer_id, batch_document_ids, current_index, batch_status)
     VALUES (gen_random_uuid(), $1, $2, $3, 0, $4)
     RETURNING *`,
    [orgId, volunteerId, JSON.stringify(documentIds), status],
  );
  return result.rows[0];
}

export async function advanceBatchSession(sessionId: string): Promise<SessionRow> {
  if (IS_MOCK) {
    const db = readMockDb();
    const session = db.sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error(`No session found: ${sessionId}`);
    const nextIndex = session.current_index + 1;
    session.current_index = nextIndex;
    session.batch_status = nextIndex >= session.batch_document_ids.length ? 'completed' : 'in_progress';
    session.updated_at = new Date().toISOString();
    writeMockDb(db);
    return session;
  }
  const result = await getPool().query<SessionRow>(
    `UPDATE sessions
     SET current_index = current_index + 1,
         batch_status = CASE
           WHEN current_index + 1 >= jsonb_array_length(batch_document_ids) THEN 'completed'
           ELSE 'in_progress'
         END,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [sessionId],
  );
  if (result.rows.length === 0) throw new Error(`No session found: ${sessionId}`);
  return result.rows[0];
}
