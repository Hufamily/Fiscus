import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// lib/audit.ts reads DATABASE_URL/COCKROACH_DATABASE_URL once at module load
// to decide real-DB vs mock-file mode. Force mock mode *before* the module is
// ever imported (deleting env after a static import would be too late), so
// this test never risks touching a real CockroachDB cluster regardless of
// what's exported in the shell running `npm test`.
delete process.env.DATABASE_URL;
delete process.env.COCKROACH_DATABASE_URL;

const { logAction } = await import('../lib/audit');

let tmpDir: string;
let mockDbPath: string;
const originalMockDb = process.env.FISCUS_MOCK_DB;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'fiscus-audit-'));
  mockDbPath = path.join(tmpDir, 'mock-db.json');
  process.env.FISCUS_MOCK_DB = mockDbPath;
});

afterEach(() => {
  if (originalMockDb === undefined) delete process.env.FISCUS_MOCK_DB;
  else process.env.FISCUS_MOCK_DB = originalMockDb;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('logAction — mock-mode audit trail (no DB configured)', () => {
  it('creates the mock db file with a well-shaped row when none exists yet', async () => {
    expect(existsSync(mockDbPath)).toBe(false);

    await logAction('org-1', 'vol-1', 'document_uploaded', 'documents', 'doc-1', { s3_key: 'org-1/doc-1/original.pdf' });

    expect(existsSync(mockDbPath)).toBe(true);
    const db = JSON.parse(readFileSync(mockDbPath, 'utf-8'));
    expect(db.templates).toEqual([]);
    expect(db.audit_log).toHaveLength(1);

    const row = db.audit_log[0];
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.org_id).toBe('org-1');
    expect(row.actor_id).toBe('vol-1');
    expect(row.action).toBe('document_uploaded');
    expect(row.target_table).toBe('documents');
    expect(row.target_id).toBe('doc-1');
    expect(row.detail_json).toEqual({ s3_key: 'org-1/doc-1/original.pdf' });
    expect(new Date(row.created_at).toISOString()).toBe(row.created_at);
  });

  it('appends to existing rows rather than clobbering them', async () => {
    writeFileSync(mockDbPath, JSON.stringify({
      templates: [{ id: 'tpl-1' }],
      audit_log: [{ id: 'existing-1', action: 'template_generated' }],
    }));

    await logAction('org-1', 'vol-1', 'transaction_approved', 'transactions', 'txn-1', {});

    const db = JSON.parse(readFileSync(mockDbPath, 'utf-8'));
    expect(db.templates).toEqual([{ id: 'tpl-1' }]);
    expect(db.audit_log).toHaveLength(2);
    expect(db.audit_log[0].id).toBe('existing-1');
    expect(db.audit_log[1].action).toBe('transaction_approved');
  });

  it('gives every write a distinct id even for identical calls', async () => {
    await logAction('org-1', 'vol-1', 'access_denied', 'transactions', 't1', { role: 'leadership' });
    await logAction('org-1', 'vol-1', 'access_denied', 'transactions', 't1', { role: 'leadership' });

    const db = JSON.parse(readFileSync(mockDbPath, 'utf-8'));
    expect(db.audit_log).toHaveLength(2);
    expect(db.audit_log[0].id).not.toBe(db.audit_log[1].id);
  });
});
