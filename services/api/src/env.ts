// Shared mock/real-DB bootstrap for the HTTP server, mirroring the
// IS_MOCK / FISCUS_MOCK_DB pattern used by every other module's client.ts
// (services/agent, services/ingestion/embeddings, services/api/summaries,
// services/ingestion/template-gen).
//
// IMPORTANT: server.ts imports the agent/embeddings/summaries modules it
// delegates to, and each of THEIR client.ts files sets
// `process.env.FISCUS_MOCK_DB` as a module-load side effect, pointing at
// their own package-local fixtures/mock-db.json. Whichever import happens
// last "wins" that race. This file's override below is applied from
// server.ts *after* all of those imports run, so it deterministically wins
// instead: every write in a single server process (ours and the delegated
// modules') lands in one shared fixtures/mock-db.json, which is what makes
// the mock-mode integration tests (and the mock-mode demo) internally
// consistent across endpoints.

import path from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import pg from 'pg';

const { Pool } = pg;

export const MODULE_ROOT = path.resolve(__dirname, '..');
export const MOCK_DB_PATH = process.env.FISCUS_MOCK_DB_PATH
  ?? path.resolve(MODULE_ROOT, 'fixtures', 'mock-db.json');

// Force every already-imported (and any later-imported) module's audit/data
// calls onto this one shared fixture file for the lifetime of this process.
process.env.FISCUS_MOCK_DB = MOCK_DB_PATH;

const DB_URL = process.env.DATABASE_URL ?? process.env.COCKROACH_DATABASE_URL;
const HAS_AWS = !!(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE);
export const IS_MOCK = !DB_URL || !HAS_AWS;

// Same fixed demo org every other module's mock/CLI path uses (AGENTS.md
// §4: organizations is the tenant root; every other tenant-scoped table
// carries org_id). Keeping this identical across modules is what lets the
// mock-mode fixture be shared and internally consistent.
export const ORG_ID = '00000000-0000-0000-0000-000000000001';

let _pool: InstanceType<typeof Pool> | null = null;
export function getPool(): InstanceType<typeof Pool> {
  if (!_pool) _pool = new Pool({ connectionString: DB_URL! });
  return _pool;
}

export interface MockOrganization {
  id: string; name: string; retention_years: number; created_at: string;
}
export interface MockVolunteer {
  id: string; org_id: string; role: 'data_entry' | 'reviewer' | 'treasurer' | 'leadership'; display_name: string;
}
export interface MockExtractedField { key: string; label: string; value: string; confidence: number; }
export interface MockDocument {
  id: string; org_id: string; s3_key: string; doc_type: string; status: string; uploaded_by: string; created_at: string;
}
export interface MockTransaction {
  id: string; org_id: string; document_id: string; category: string; amount_cents: number; currency: string;
  txn_date: string; extracted_fields: MockExtractedField[]; status: string; created_at: string;
}
export interface MockCorrection {
  id: string; org_id: string; transaction_id: string; field: string; original_value: string; corrected_value: string;
  corrected_by: string; created_at: string;
}
export interface MockTemplateField { key: string; label: string; type: string; sample: string; }
export interface MockTemplate {
  id: string; org_id: string; form_type: string; status: 'pending_review' | 'approved';
  fields: MockTemplateField[]; example_doc_id: string; created_at: string;
}
export interface MockAuditRow {
  id: string; org_id: string; actor_id: string; action: string; target_table: string; target_id: string;
  detail_json: Record<string, unknown>; created_at: string;
}

export interface MockDb {
  organizations: MockOrganization[];
  volunteers: MockVolunteer[];
  documents: MockDocument[];
  transactions: MockTransaction[];
  corrections: MockCorrection[];
  templates: MockTemplate[];
  audit_log: MockAuditRow[];
  // present so the delegated modules' own mock readers (which expect a
  // superset/subset of this same file) don't choke on a missing key.
  sessions: unknown[];
  summaries: unknown[];
}

const EMPTY_DB: MockDb = {
  organizations: [], volunteers: [], documents: [], transactions: [],
  corrections: [], templates: [], audit_log: [], sessions: [], summaries: [],
};

export function readMockDb(): MockDb {
  if (!existsSync(MOCK_DB_PATH)) return { ...EMPTY_DB };
  const raw = JSON.parse(readFileSync(MOCK_DB_PATH, 'utf-8')) as Partial<MockDb>;
  return { ...EMPTY_DB, ...raw };
}

export function writeMockDb(db: MockDb): void {
  writeFileSync(MOCK_DB_PATH, JSON.stringify(db, null, 2));
}

// Real mode's tables key everything off a UUID column. Mock mode's ids
// (e.g. "vol_amy", "doc_vet1") are plain strings and never hit this path.
// Without this guard, an arbitrary caller-supplied id (a request header, a
// route param) that isn't UUID-shaped reaches CockroachDB as a raw query
// parameter and fails with a driver-level parse error — surfacing as an
// uncaught 500 instead of the intended "not found" (401/404) response.
// Caught live against the real cluster: an unrecognized
// x-fiscus-volunteer-id header should 401, not 500.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(id: string): boolean {
  return UUID_RE.test(id);
}
