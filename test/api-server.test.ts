// Integration/contract tests for the services/api HTTP server (issue #26).
// Exercises the real Express app + real lib/rbac.ts + real lib/audit.ts +
// real lib/redact.ts end-to-end via supertest, against a throwaway copy of
// services/api/fixtures/mock-db.json (so nothing here mutates the checked-in
// fixture or leaves the working tree dirty).
//
// The two Bedrock-backed client layers this server delegates to
// (services/agent, services/api/summaries) are mocked at their `client.ts`
// boundary — mirroring test/summaries.test.ts's existing pattern — because
// their mock-mode code paths persist to THEIR OWN checked-in
// fixtures/mock-db.json files (session state / summary rows), independent of
// this server's FISCUS_MOCK_DB_PATH override. services/ingestion/embeddings
// is left unmocked: its mock-mode search is read-only (no persistence) and
// deterministic, so calling it for real is safe and more faithfully
// "integration."
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, copyFileSync, readFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import type { Express } from 'express';

const agentClientMocks = vi.hoisted(() => ({
  IS_MOCK: true,
  ORG_ID: '00000000-0000-0000-0000-000000000001',
  VOLUNTEER_ID: 'cli-volunteer',
  invokeModel: vi.fn(),
  getAggregates: vi.fn().mockResolvedValue([]),
  getSimilarTransactions: vi.fn().mockResolvedValue([]),
  getSession: vi.fn().mockResolvedValue(null),
  upsertSession: vi.fn().mockResolvedValue({
    id: 'sess-test', org_id: '00000000-0000-0000-0000-000000000001',
    volunteer_id: 'vol_amy', pending_documents: {}, current_index: 0, updated_at: new Date().toISOString(),
  }),
}));
vi.mock('../services/agent/src/client', () => agentClientMocks);

const summariesClientMocks = vi.hoisted(() => ({
  IS_MOCK: true,
  invokeModel: vi.fn().mockResolvedValue('stub summary'),
  getAggregates: vi.fn().mockResolvedValue([
    { category: 'veterinary', status: 'pending_review', total_cents: 32408, count: 1 },
    { category: 'veterinary', status: 'approved', total_cents: 24469, count: 1 },
    { category: 'office_supplies', status: 'approved', total_cents: 8750, count: 1 },
  ]),
  insertSummary: vi.fn().mockResolvedValue({
    id: 'sum-test', org_id: '00000000-0000-0000-0000-000000000001',
    period_label: 'YTD', body: 'stub summary', created_at: new Date().toISOString(),
  }),
}));
vi.mock('../services/api/summaries/src/client', () => summariesClientMocks);

const ORG_ID = '00000000-0000-0000-0000-000000000001';

let app: Express;
let tmpDir: string;
let tmpDbPath: string;

interface AuditRow {
  id: string; org_id: string; actor_id: string; action: string;
  target_table: string; target_id: string; detail_json: Record<string, unknown>; created_at: string;
}

function auditLog(): AuditRow[] {
  return (JSON.parse(readFileSync(tmpDbPath, 'utf-8')) as { audit_log: AuditRow[] }).audit_log;
}

function asVolunteer(id: string) {
  return { 'x-fiscus-volunteer-id': id };
}

beforeAll(async () => {
  // Deterministic mock mode regardless of what a developer's shell has
  // exported (this repo's .env, when present, is only auto-loaded by
  // services/api/src/index.ts — not by server.ts, which this test imports
  // directly — but these deletes are defense in depth).
  delete process.env.DATABASE_URL;
  delete process.env.COCKROACH_DATABASE_URL;
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_PROFILE;

  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'fiscus-api-test-'));
  tmpDbPath = path.join(tmpDir, 'mock-db.json');
  copyFileSync(path.resolve(__dirname, '../services/api/fixtures/mock-db.json'), tmpDbPath);
  process.env.FISCUS_MOCK_DB_PATH = tmpDbPath;

  const { createApp } = await import('../services/api/src/server.js');
  app = createApp();
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.FISCUS_MOCK_DB_PATH;
});

describe('org / volunteers — open reads', () => {
  it('GET /api/org returns the org', async () => {
    const res = await request(app).get('/api/org').set(asVolunteer('vol_amy'));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ORG_ID);
  });

  it('GET /api/volunteers returns all four demo volunteers', async () => {
    const res = await request(app).get('/api/volunteers').set(asVolunteer('vol_amy'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
  });
});

describe('auth', () => {
  it('defaults to the data_entry demo volunteer when no header is sent', async () => {
    const res = await request(app).get('/api/documents');
    expect(res.status).toBe(200); // data_entry has view_row_level_transactions
  });

  it('401s for an unknown volunteer id', async () => {
    const res = await request(app).get('/api/documents').set(asVolunteer('vol_nobody'));
    expect(res.status).toBe(401);
  });
});

describe('RBAC enforcement (AGENTS.md §5.3) — 403 + audited denial', () => {
  it('denies data_entry a treasurer-only route (view_aggregate_reports) with a real 403, and audits it', async () => {
    const before = auditLog().length;
    const res = await request(app).get('/api/summary?period=YTD').set(asVolunteer('vol_amy'));
    expect(res.status).toBe(403);

    const after = auditLog();
    expect(after.length).toBe(before + 1);
    const denial = after[after.length - 1];
    expect(denial.action).toBe('access_denied');
    expect(denial.actor_id).toBe('vol_amy');
    expect(denial.detail_json).toMatchObject({ role: 'data_entry', capability: 'view_aggregate_reports' });
  });

  it('denies data_entry from approving templates, and audits it', async () => {
    const before = auditLog().length;
    const res = await request(app).post('/api/templates/tpl_supply_receipt/approve').set(asVolunteer('vol_amy'));
    expect(res.status).toBe(403);
    expect(auditLog().length).toBe(before + 1);
  });

  it('never lets leadership reach row-level transactions — the AGENTS.md §5.3 rule that matters most', async () => {
    const res = await request(app).get('/api/documents').set(asVolunteer('vol_pat'));
    expect(res.status).toBe(403);
  });

  it('never lets leadership bypass the aggregate-only restriction via free-text search', async () => {
    const res = await request(app).get('/api/search?q=vet').set(asVolunteer('vol_pat'));
    expect(res.status).toBe(403);
  });

  it('denies leadership from approving transactions (no review_extractions capability)', async () => {
    const res = await request(app).post('/api/transactions/txn_donation1/approve').set(asVolunteer('vol_pat'));
    expect(res.status).toBe(403);
  });

  it('allows treasurer and leadership through to the structured leadership summary', async () => {
    for (const id of ['vol_dana', 'vol_pat']) {
      const res = await request(app).get('/api/summary?period=YTD').set(asVolunteer(id));
      expect(res.status).toBe(200);
      expect(res.body.org_id).toBe(ORG_ID);
      expect(typeof res.body.total_spend_cents).toBe('number');
      expect(Array.isArray(res.body.by_category)).toBe(true);
      expect(Array.isArray(res.body.monthly_spend_cents)).toBe(true);
    }
  });
});

describe('audit trail — every write produces exactly one audit row', () => {
  it('uploadDocument writes exactly one document_uploaded row', async () => {
    const before = auditLog().length;
    const res = await request(app).post('/api/documents').set(asVolunteer('vol_amy')).send({ name: 'receipt.pdf', doc_type: 'supply_receipt' });
    expect(res.status).toBe(201);

    const after = auditLog();
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]).toMatchObject({ action: 'document_uploaded', actor_id: 'vol_amy' });
  });

  it('applyCorrection on your own upload writes exactly one correction_applied row', async () => {
    const before = auditLog().length;
    const res = await request(app).post('/api/corrections').set(asVolunteer('vol_amy')).send({
      transaction_id: 'txn_vet1', field: 'invoice_number', original_value: 'INV-240822', corrected_value: 'INV-240822-A',
    });
    expect(res.status).toBe(201);

    const after = auditLog();
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]).toMatchObject({ action: 'correction_applied', actor_id: 'vol_amy' });
  });

  it('applyCorrection on someone else\'s upload is denied (own-uploads-only) and audits the denial once', async () => {
    // txn_donation1 -> doc_donation1 was uploaded by vol_raj, not vol_amy.
    const before = auditLog().length;
    const res = await request(app).post('/api/corrections').set(asVolunteer('vol_amy')).send({
      transaction_id: 'txn_donation1', field: 'donor', original_value: 'x', corrected_value: 'y',
    });
    expect(res.status).toBe(403);

    const after = auditLog();
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1].action).toBe('access_denied');
  });

  it('approveTransaction writes exactly one transaction_approved row', async () => {
    const before = auditLog().length;
    const res = await request(app).post('/api/transactions/txn_vet1/approve').set(asVolunteer('vol_raj'));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');

    const after = auditLog();
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]).toMatchObject({ action: 'transaction_approved', actor_id: 'vol_raj' });
  });

  it('approveTemplate writes exactly one template_approved row', async () => {
    const before = auditLog().length;
    const res = await request(app).post('/api/templates/tpl_supply_receipt/approve').set(asVolunteer('vol_raj'));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');

    const after = auditLog();
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]).toMatchObject({ action: 'template_approved', actor_id: 'vol_raj' });
  });
});

describe('redaction — a raw card number never appears in any response or persisted row', () => {
  // Standard Luhn-valid test number (CLAUDE.md's B2 learning: fake numbers
  // must actually pass the Luhn check to be redacted, so use a real test PAN).
  const CARD = '4111 1111 1111 1111';

  it('redacts a card number in a correction before it is returned or persisted', async () => {
    const res = await request(app).post('/api/corrections').set(asVolunteer('vol_amy')).send({
      transaction_id: 'txn_vet1', field: 'card_on_file', original_value: 'none', corrected_value: CARD,
    });
    expect(res.status).toBe(201);
    expect(res.body.corrected_value).not.toContain('4111 1111 1111 1111');
    expect(res.body.corrected_value).not.toContain('4111111111111111');
    expect(res.body.corrected_value.slice(-4)).toBe('1111'); // last 4 preserved, per lib/redact.ts

    const stored = (JSON.parse(readFileSync(tmpDbPath, 'utf-8')) as { corrections: { corrected_value: string }[] }).corrections;
    const last = stored[stored.length - 1];
    expect(last.corrected_value).not.toContain('4111111111111111');

    // And the audit trail's own detail_json must never carry the raw number either.
    const denial = auditLog()[auditLog().length - 1];
    expect(JSON.stringify(denial.detail_json)).not.toContain('4111111111111111');
  });
});

describe('remaining reads', () => {
  it('GET /api/documents/:id/transaction returns 200 for a real doc and 204 for an unknown one', async () => {
    const found = await request(app).get('/api/documents/doc_vet1/transaction').set(asVolunteer('vol_amy'));
    expect(found.status).toBe(200);
    expect(found.body.document_id).toBe('doc_vet1');

    const missing = await request(app).get('/api/documents/doc_does_not_exist/transaction').set(asVolunteer('vol_amy'));
    expect(missing.status).toBe(204);
  });

  it('GET /api/templates includes a computed field_count', async () => {
    const res = await request(app).get('/api/templates').set(asVolunteer('vol_amy'));
    expect(res.status).toBe(200);
    const tpl = res.body.find((t: { id: string }) => t.id === 'tpl_vet_invoice');
    expect(tpl.field_count).toBe(tpl.fields.length);
  });

  it('GET /api/activity and /api/corrections/learned are open reads', async () => {
    const activity = await request(app).get('/api/activity').set(asVolunteer('vol_pat'));
    expect(activity.status).toBe(200);
    expect(Array.isArray(activity.body)).toBe(true);

    const learned = await request(app).get('/api/corrections/learned').set(asVolunteer('vol_pat'));
    expect(learned.status).toBe(200);
    expect(learned.body.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/session derives a pending-review queue for the caller', async () => {
    const res = await request(app).get('/api/session').set(asVolunteer('vol_amy'));
    expect([200, 204]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.volunteer_id).toBe('vol_amy');
      expect(Array.isArray(res.body.pending_document_ids)).toBe(true);
    }
  });

  it('POST /api/agent/ask delegates to services/agent (mocked client, deterministic mock answer)', async () => {
    const res = await request(app).post('/api/agent/ask').set(asVolunteer('vol_dana')).send({ question: 'What did we spend on vet costs?' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('agent');
    expect(typeof res.body.text).toBe('string');
  });

  it('GET /api/search delegates to services/ingestion/embeddings for a role that may see row-level data', async () => {
    const res = await request(app).get('/api/search?q=vet').set(asVolunteer('vol_dana'));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
