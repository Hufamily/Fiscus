// Shared audit helper — all tracks import this per AGENTS.md §6.
// Real mode: inserts into audit_log table via DATABASE_URL / COCKROACH_DATABASE_URL.
// Mock mode (no DB URL): appends to the JSON file at FISCUS_MOCK_DB env var path.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import pg from 'pg';

const { Pool } = pg;
const DB_URL = process.env.DATABASE_URL ?? process.env.COCKROACH_DATABASE_URL;
let _pool: InstanceType<typeof Pool> | null = null;

function getPool(): InstanceType<typeof Pool> {
  if (!_pool) _pool = new Pool({ connectionString: DB_URL! });
  return _pool;
}

export async function logAction(
  orgId: string,
  actorId: string,
  action: string,
  targetTable: string,
  targetId: string,
  detail: Record<string, unknown>,
): Promise<void> {
  if (!DB_URL) {
    const mockPath = process.env.FISCUS_MOCK_DB ?? './fixtures/mock-db.json';
    const raw = existsSync(mockPath) ? readFileSync(mockPath, 'utf8') : '{"templates":[],"audit_log":[]}';
    const db = JSON.parse(raw) as { templates: unknown[]; audit_log: unknown[] };
    db.audit_log.push({
      id: randomUUID(),
      org_id: orgId,
      actor_id: actorId,
      action,
      target_table: targetTable,
      target_id: targetId,
      detail_json: detail,
      created_at: new Date().toISOString(),
    });
    writeFileSync(mockPath, JSON.stringify(db, null, 2));
    return;
  }

  await getPool().query(
    `INSERT INTO audit_log (id, org_id, actor_id, action, target_table, target_id, detail_json, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
    [randomUUID(), orgId, actorId, action, targetTable, targetId, JSON.stringify(detail)],
  );
}
