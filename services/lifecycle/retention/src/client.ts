// DB client + S3 for the retention-lifecycle module.
// Mirrors the other services/*/src/client.ts modules: IS_MOCK detection,
// FISCUS_MOCK_DB, real pg pool + S3Client. Uses summaries' IS_MOCK shape
// (DB_URL *and* AWS creds both required for "real" mode) rather than
// s3-extraction's (DB_URL alone), since this module's real path needs both
// CockroachDB and S3, same as summaries needs both CockroachDB and Bedrock.

import path from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import pg from 'pg';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { OrganizationRow, DocumentRow } from './types';

const { Pool } = pg;

export const MODULE_ROOT = path.resolve(__dirname, '..');
export const MOCK_DB_PATH = path.resolve(MODULE_ROOT, 'fixtures', 'mock-db.json');
process.env.FISCUS_MOCK_DB = MOCK_DB_PATH;

const DB_URL = process.env.DATABASE_URL ?? process.env.COCKROACH_DATABASE_URL;
const HAS_AWS = !!(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE);
export const IS_MOCK = !DB_URL || !HAS_AWS;

export const SYSTEM_ACTOR = 'retention-lifecycle-system';
export const DEFAULT_RETENTION_YEARS = 7;

// Bucket the raw documents live in. Real deploys pass this via the Lambda's
// environment (see template.yaml); local/CLI use falls back to the same
// placeholder name s3-extraction's upload CLI uses.
export const INGESTION_BUCKET = process.env.INGESTION_BUCKET ?? 'fiscus-ingestion-local';

// ── Mock DB ───────────────────────────────────────────────────────────────
export interface MockDb {
  organizations: OrganizationRow[];
  documents: DocumentRow[];
  transactions: unknown[];
  // Mock stand-in for actual S3 bucket contents -- keys present here are
  // "objects that exist"; deleteS3Object() removes the key to simulate a
  // real DeleteObjectCommand without needing AWS credentials.
  s3_objects: string[];
  audit_log: unknown[];
  [key: string]: unknown;
}

function emptyMockDb(): MockDb {
  return { organizations: [], documents: [], transactions: [], s3_objects: [], audit_log: [] };
}

export function readMockDb(): MockDb {
  if (!existsSync(MOCK_DB_PATH)) return emptyMockDb();
  const raw = JSON.parse(readFileSync(MOCK_DB_PATH, 'utf-8')) as Partial<MockDb>;
  return { ...emptyMockDb(), ...raw };
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

// ── Real S3 client ────────────────────────────────────────────────────────
let _s3: S3Client | null = null;
function getS3(): S3Client {
  if (!_s3) _s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
  return _s3;
}

// ── Organizations ─────────────────────────────────────────────────────────
export async function fetchOrganizations(): Promise<OrganizationRow[]> {
  if (IS_MOCK) return readMockDb().organizations;
  const result = await getPool().query<OrganizationRow>(
    'SELECT id, name, retention_years FROM organizations',
  );
  return result.rows;
}

// ── Documents past their org's retention cutoff, still holding a raw file ──
// (status != 'purged' is the "still has a raw file present" signal --
// once purged the S3 object is gone and re-selecting it would try to
// delete an object that no longer exists.)
export async function fetchPurgeCandidates(orgId: string, cutoffIso: string): Promise<DocumentRow[]> {
  if (IS_MOCK) {
    const db = readMockDb();
    return db.documents.filter(
      (d) => d.org_id === orgId && d.status !== 'purged' && new Date(d.created_at).getTime() < new Date(cutoffIso).getTime(),
    );
  }
  const result = await getPool().query<DocumentRow>(
    `SELECT id, org_id, s3_key, doc_type, status, uploaded_by, created_at
     FROM documents
     WHERE org_id = $1 AND status != 'purged' AND created_at < $2`,
    [orgId, cutoffIso],
  );
  return result.rows;
}

export async function markDocumentPurged(documentId: string, orgId: string): Promise<void> {
  if (IS_MOCK) {
    const db = readMockDb();
    const doc = db.documents.find((d) => d.id === documentId && d.org_id === orgId);
    if (doc) doc.status = 'purged';
    writeMockDb(db);
    return;
  }
  await getPool().query(`UPDATE documents SET status = 'purged' WHERE id = $1 AND org_id = $2`, [
    documentId,
    orgId,
  ]);
}

// ── S3 delete ─────────────────────────────────────────────────────────────
export async function deleteS3Object(bucket: string, key: string): Promise<void> {
  if (IS_MOCK) {
    const db = readMockDb();
    db.s3_objects = (db.s3_objects ?? []).filter((k) => k !== key);
    writeMockDb(db);
    return;
  }
  await getS3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
