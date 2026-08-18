// DB + S3 client for the documents (A4: raw document retrieval) module.
// Mirrors services/api/summaries/src/client.ts and
// services/ingestion/s3-extraction/src/client.ts: IS_MOCK detection,
// FISCUS_MOCK_DB, real pg pool. The S3 presign call itself reuses the same
// getSignedUrl / @aws-sdk/s3-request-presigner pattern as
// services/ingestion/s3-extraction/src/upload.ts (that one presigns a PUT
// for uploads; this one presigns a GET for reads), rather than inventing a
// new S3 client setup.

import path from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import pg from 'pg';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { DocumentRow } from './types';

const { Pool } = pg;

export const MODULE_ROOT = path.resolve(__dirname, '..');
export const MOCK_DB_PATH = path.resolve(MODULE_ROOT, 'fixtures', 'mock-db.json');
process.env.FISCUS_MOCK_DB = MOCK_DB_PATH;

const DB_URL = process.env.DATABASE_URL ?? process.env.COCKROACH_DATABASE_URL;
const HAS_AWS = !!(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE);
export const IS_MOCK = !DB_URL || !HAS_AWS;

export const ORG_ID = '00000000-0000-0000-0000-000000000001';
export const ACTOR_ID = 'cli-system';

// A4 spec: pre-signed, short-TTL S3 URLs — 5 minutes, not configurable per
// call, so a caller can't silently ask for a long-lived link.
export const TTL_SECONDS = 300;

// ── Mock DB ───────────────────────────────────────────────────────────────
interface MockDb {
  documents: DocumentRow[];
  audit_log: unknown[];
  [key: string]: unknown;
}

function readMockDb(): MockDb {
  if (!existsSync(MOCK_DB_PATH)) {
    return { documents: [], audit_log: [] };
  }
  return JSON.parse(readFileSync(MOCK_DB_PATH, 'utf-8')) as MockDb;
}

// Exposed for the CLI's convenience (e.g. seeding a document to retrieve).
export function writeMockDb(db: MockDb): void {
  writeFileSync(MOCK_DB_PATH, JSON.stringify(db, null, 2));
}

// ── Real DB pool ──────────────────────────────────────────────────────────
let _pool: InstanceType<typeof Pool> | null = null;
function getPool(): InstanceType<typeof Pool> {
  if (!_pool) _pool = new Pool({ connectionString: DB_URL! });
  return _pool;
}

// ── Document lookup ───────────────────────────────────────────────────────
export async function getDocument(documentId: string, orgId: string): Promise<DocumentRow | null> {
  if (IS_MOCK) {
    const db = readMockDb();
    return db.documents.find((d) => d.id === documentId && d.org_id === orgId) ?? null;
  }
  const result = await getPool().query<DocumentRow>(
    `SELECT id, org_id, s3_key, doc_type, status, uploaded_by
     FROM documents WHERE id = $1 AND org_id = $2`,
    [documentId, orgId],
  );
  return result.rows[0] ?? null;
}

// ── Pre-signed GET URL ────────────────────────────────────────────────────
export interface PresignOpts {
  bucket: string;
  region: string;
  ttlSeconds: number;
  issuedAt: Date;
}

// Mock mode returns a fake pre-signed-looking URL with the expiry embedded
// as a query param (rather than a real S3 call), per CLAUDE.md's
// documented IS_MOCK convention — good enough for tests/CLI to assert
// against without a real AWS credential.
export async function presignGetUrl(key: string, opts: PresignOpts): Promise<string> {
  const expiresAt = new Date(opts.issuedAt.getTime() + opts.ttlSeconds * 1000);
  if (IS_MOCK) {
    return `mock://local-download/${opts.bucket}/${key}?expires=${expiresAt.getTime()}`;
  }
  return getSignedUrl(
    new S3Client({ region: opts.region }),
    new GetObjectCommand({ Bucket: opts.bucket, Key: key }),
    { expiresIn: opts.ttlSeconds },
  );
}
