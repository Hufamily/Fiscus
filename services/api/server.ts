// services/api/server.ts — Node built-in HTTP server; zero new dependencies.
// Run via: npm run api:serve (tsx services/api/server.ts)
// Reads X-Fiscus-Role header to determine RBAC subject; defaults to data_entry.
// IS_MOCK detection mirrors every other module: no DB_URL or no AWS creds = mock.

import http from 'http';
import path from 'path';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import pg from 'pg';
import { logAction } from '../../lib/audit';
import { enforceAccess, type AccessSubject, type VolunteerRole } from '../../lib/rbac';
import { embed } from '../../lib/embeddings';
import { ask } from '../agent/src/agent';
import { approveTemplate as doApproveTemplate } from '../ingestion/template-gen/src/approve';
import {
  getTemplate,
  setTemplateApproved,
  ORG_ID as _TPLORG,
} from '../ingestion/template-gen/src/client';

void _TPLORG; // imported for module side-effect (sets FISCUS_MOCK_DB); unused directly

const { Pool } = pg;

// ── Constants ─────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '8080', 10);
const DB_URL = process.env.DATABASE_URL ?? process.env.COCKROACH_DATABASE_URL;
const HAS_AWS = !!(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE);
const IS_MOCK = !DB_URL || !HAS_AWS;
const ORG_ID = '00000000-0000-0000-0000-000000000001';

const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'https://fiscus-blue.vercel.app',
]);

// Demo: map incoming role to a seeded volunteer UUID (matches db/seed.ts)
const ROLE_IDS: Record<string, string> = {
  data_entry: '10000000-0000-0000-0000-000000000001',
  reviewer:   '10000000-0000-0000-0000-000000000002',
  treasurer:  '10000000-0000-0000-0000-000000000003',
  leadership: '10000000-0000-0000-0000-000000000004',
};

const VALID_ROLES: VolunteerRole[] = ['data_entry', 'reviewer', 'treasurer', 'leadership'];

// ── pg Pool ───────────────────────────────────────────────────────────────────
let _pool: InstanceType<typeof Pool> | null = null;
function getPool(): InstanceType<typeof Pool> {
  if (!_pool) _pool = new Pool({ connectionString: DB_URL!, ssl: { rejectUnauthorized: false } });
  return _pool;
}

// ── Mock DB (server-level) ────────────────────────────────────────────────────
// Agent fixtures are the most complete mock dataset; use as the server's mock source.
// Module-imported functions (ask, approveTemplate) use their own fixtures — that's fine.
const AGENT_MOCK = path.resolve(__dirname, '../agent/fixtures/mock-db.json');
const TPL_MOCK   = path.resolve(__dirname, '../ingestion/template-gen/fixtures/mock-db.json');

interface MockDoc { id: string; org_id: string; s3_key: string; doc_type: string; status: string; uploaded_by: string; created_at: string; }
interface MockTxn { id: string; org_id: string; document_id: string; category: string; amount_cents: number; currency: string; txn_date: string; extracted_fields_json: Array<{key:string;value:string}>; status: string; created_at: string; }
interface MockCorrection { id: string; org_id: string; transaction_id: string; field: string; original_value: string; corrected_value: string; corrected_by: string; created_at: string; }
interface MockSession { id: string; org_id: string; volunteer_id: string; pending_documents: { conversation?: Array<{question:string;answer:string}> }; current_index: number; updated_at: string; }
interface MockAudit { id: string; org_id: string; actor_id: string; action: string; target_table: string; target_id: string; detail_json: Record<string,unknown>; created_at: string; }

interface AgentMockDb {
  documents: MockDoc[];
  transactions: MockTxn[];
  corrections?: MockCorrection[];
  sessions: MockSession[];
  audit_log: MockAudit[];
}

function readAgentMock(): AgentMockDb {
  if (!existsSync(AGENT_MOCK)) return { documents: [], transactions: [], corrections: [], sessions: [], audit_log: [] };
  return JSON.parse(readFileSync(AGENT_MOCK, 'utf-8')) as AgentMockDb;
}

function writeAgentMock(db: AgentMockDb): void {
  writeFileSync(AGENT_MOCK, JSON.stringify(db, null, 2));
}

interface TplMockRow { id: string; org_id: string; form_type: string; schema_json: Array<{key:string;label:string;type:string;sample:string;expected_pattern?:string}>; status: string; created_at: string; }
interface TplMockDb { templates: TplMockRow[]; audit_log: unknown[]; }

function readTplMock(): TplMockDb {
  if (!existsSync(TPL_MOCK)) return { templates: [], audit_log: [] };
  return JSON.parse(readFileSync(TPL_MOCK, 'utf-8')) as TplMockDb;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function setCors(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Fiscus-Role');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function send204(res: http.ServerResponse): void {
  res.writeHead(204);
  res.end();
}

async function readBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString()) as T); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ── Shape helpers ─────────────────────────────────────────────────────────────
// Map DB/mock template row → frontend Template shape
function mapTemplate(row: {
  id: string; org_id: string; form_type: string;
  schema_json: Array<{key:string;label:string;sample:string}>;
  status: string; created_at: string;
  example_doc_id?: string | null;
}): object {
  const schema = Array.isArray(row.schema_json) ? row.schema_json : [];
  return {
    id: row.id,
    org_id: row.org_id,
    form_type: row.form_type,
    status: row.status,
    field_count: schema.length,
    example_doc_id: row.example_doc_id ?? '',
    fields: schema.map((f) => ({ key: f.key, label: f.label, sample: f.sample })),
  };
}

// Map DB/mock transaction row → frontend Transaction shape
function mapTransaction(row: {
  id: string; org_id: string; document_id: string; category: string;
  amount_cents: number | string; currency: string; txn_date: string;
  extracted_fields_json: unknown; status: string;
}): object {
  const raw = Array.isArray(row.extracted_fields_json)
    ? (row.extracted_fields_json as Array<{key:string;value:string}>)
    : [];
  return {
    id: row.id,
    org_id: row.org_id,
    document_id: row.document_id,
    category: row.category,
    amount_cents: parseInt(String(row.amount_cents), 10),
    currency: row.currency,
    txn_date: typeof row.txn_date === 'string' ? row.txn_date.slice(0, 10) : row.txn_date,
    extracted_fields: raw.map((f) => ({
      key: f.key,
      label: f.key,
      value: String(f.value),
      confidence: 1.0,
    })),
    status: row.status,
  };
}

// Audit log action → frontend ActivityAction map (unmapped actions are filtered out)
const AUDIT_TO_ACTIVITY: Record<string, string> = {
  template_generated:   'template_generated',
  template_approved:    'template_approved',
  document_uploaded:    'document_uploaded',
  transaction_extracted:'fields_extracted',
  fields_extracted:     'fields_extracted',
  correction_applied:   'correction_applied',
  transaction_approved: 'transaction_approved',
};

// ── Subject builder ────────────────────────────────────────────────────────────
function buildSubject(req: http.IncomingMessage): AccessSubject {
  const roleHeader = (req.headers['x-fiscus-role'] as string | undefined) ?? 'data_entry';
  const role: VolunteerRole = VALID_ROLES.includes(roleHeader as VolunteerRole)
    ? (roleHeader as VolunteerRole) : 'data_entry';
  const volunteerId = ROLE_IDS[role] ?? ROLE_IDS.data_entry;
  return { volunteerId, orgId: ORG_ID, role };
}

// ── Endpoint handlers ─────────────────────────────────────────────────────────

async function handleGetOrg(res: http.ServerResponse): Promise<void> {
  if (IS_MOCK) {
    sendJson(res, 200, {
      id: ORG_ID,
      name: 'Demo Nonprofit',
      retention_years: 7,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    return;
  }
  const { rows } = await getPool().query<{id:string;name:string;retention_years:string|number;created_at:string}>(
    'SELECT id, name, retention_years, created_at FROM organizations WHERE id = $1', [ORG_ID],
  );
  if (!rows[0]) { sendJson(res, 404, { error: 'org not found' }); return; }
  const r = rows[0];
  sendJson(res, 200, { ...r, retention_years: parseInt(String(r.retention_years), 10) });
}

async function handleGetVolunteers(res: http.ServerResponse): Promise<void> {
  if (IS_MOCK) {
    sendJson(res, 200, [
      { id: ROLE_IDS.data_entry,  org_id: ORG_ID, role: 'data_entry',  display_name: 'Amy' },
      { id: ROLE_IDS.reviewer,    org_id: ORG_ID, role: 'reviewer',    display_name: 'Raj' },
      { id: ROLE_IDS.treasurer,   org_id: ORG_ID, role: 'treasurer',   display_name: 'Dana' },
      { id: ROLE_IDS.leadership,  org_id: ORG_ID, role: 'leadership',  display_name: 'Pat' },
    ]);
    return;
  }
  const { rows } = await getPool().query(
    'SELECT id, org_id, role, display_name FROM volunteers WHERE org_id = $1 ORDER BY display_name', [ORG_ID],
  );
  sendJson(res, 200, rows);
}

async function handleListDocuments(res: http.ServerResponse): Promise<void> {
  if (IS_MOCK) {
    sendJson(res, 200, readAgentMock().documents.filter(d => d.org_id === ORG_ID));
    return;
  }
  const { rows } = await getPool().query(
    'SELECT id, org_id, s3_key, doc_type, status, uploaded_by, created_at FROM documents WHERE org_id = $1 ORDER BY created_at DESC', [ORG_ID],
  );
  sendJson(res, 200, rows);
}

async function handleGetTransactionForDoc(res: http.ServerResponse, docId: string, subject: AccessSubject): Promise<void> {
  await enforceAccess(subject, { capability: 'view_row_level_transactions', targetTable: 'transactions', targetId: docId });
  if (IS_MOCK) {
    const db = readAgentMock();
    const txn = db.transactions.find(t => t.document_id === docId && t.org_id === ORG_ID);
    if (!txn) { send204(res); return; }
    sendJson(res, 200, mapTransaction(txn));
    return;
  }
  const { rows } = await getPool().query(
    'SELECT id, org_id, document_id, category, amount_cents, currency, txn_date, extracted_fields_json, status FROM transactions WHERE document_id = $1 AND org_id = $2 LIMIT 1',
    [docId, ORG_ID],
  );
  if (!rows[0]) { send204(res); return; }
  sendJson(res, 200, mapTransaction(rows[0] as Parameters<typeof mapTransaction>[0]));
}

async function handleApplyCorrection(
  req: http.IncomingMessage, res: http.ServerResponse, subject: AccessSubject,
): Promise<void> {
  const body = await readBody<{ transaction_id: string; field: string; original_value: string; corrected_value: string }>(req);
  // For data_entry: RBAC requires own-upload check. We pass uploadedBy from DB.
  // In mock mode we bypass this restriction (no real auth in demo).
  let uploadedBy: string | undefined;
  if (!IS_MOCK) {
    const { rows } = await getPool().query<{ uploaded_by: string }>(
      'SELECT d.uploaded_by FROM transactions t JOIN documents d ON d.id = t.document_id WHERE t.id = $1 AND t.org_id = $2',
      [body.transaction_id, ORG_ID],
    );
    uploadedBy = rows[0]?.uploaded_by;
  } else {
    uploadedBy = subject.volunteerId; // mock: always pass own-upload check
  }
  await enforceAccess(subject, {
    capability: 'apply_corrections',
    targetTable: 'corrections',
    targetId: body.transaction_id,
    uploadedBy,
  });

  if (IS_MOCK) {
    const db = readAgentMock();
    if (!db.corrections) db.corrections = [];
    const row: MockCorrection = {
      id: randomUUID(),
      org_id: ORG_ID,
      transaction_id: body.transaction_id,
      field: body.field,
      original_value: body.original_value,
      corrected_value: body.corrected_value,
      corrected_by: subject.volunteerId,
      created_at: new Date().toISOString(),
    };
    db.corrections.push(row);
    writeAgentMock(db);
    await logAction(ORG_ID, subject.volunteerId, 'correction_applied', 'corrections', row.id, { field: body.field, corrected_value: body.corrected_value });
    sendJson(res, 200, row);
    return;
  }

  const { rows } = await getPool().query(
    `INSERT INTO corrections (org_id, transaction_id, field, original_value, corrected_value, corrected_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [ORG_ID, body.transaction_id, body.field, body.original_value, body.corrected_value, subject.volunteerId],
  );
  await logAction(ORG_ID, subject.volunteerId, 'correction_applied', 'corrections', rows[0].id as string, { field: body.field });
  sendJson(res, 200, rows[0]);
}

async function handleApproveTransaction(res: http.ServerResponse, txnId: string, subject: AccessSubject): Promise<void> {
  await enforceAccess(subject, { capability: 'review_extractions', targetTable: 'transactions', targetId: txnId });
  if (IS_MOCK) {
    const db = readAgentMock();
    const idx = db.transactions.findIndex(t => t.id === txnId && t.org_id === ORG_ID);
    if (idx === -1) { sendJson(res, 404, { error: 'transaction not found' }); return; }
    db.transactions[idx].status = 'approved';
    writeAgentMock(db);
    await logAction(ORG_ID, subject.volunteerId, 'transaction_approved', 'transactions', txnId, {});
    sendJson(res, 200, mapTransaction(db.transactions[idx]));
    return;
  }
  const { rows } = await getPool().query(
    "UPDATE transactions SET status='approved' WHERE id=$1 AND org_id=$2 RETURNING id, org_id, document_id, category, amount_cents, currency, txn_date, extracted_fields_json, status",
    [txnId, ORG_ID],
  );
  if (!rows[0]) { sendJson(res, 404, { error: 'transaction not found' }); return; }
  await logAction(ORG_ID, subject.volunteerId, 'transaction_approved', 'transactions', txnId, {});
  sendJson(res, 200, mapTransaction(rows[0] as Parameters<typeof mapTransaction>[0]));
}

async function handleListTemplates(res: http.ServerResponse): Promise<void> {
  if (IS_MOCK) {
    const db = readTplMock();
    const docs = readAgentMock().documents;
    const rows = db.templates
      .filter(t => t.org_id === ORG_ID)
      .map(t => {
        const exampleDoc = docs.find(d => d.doc_type === t.form_type);
        return mapTemplate({ ...t, example_doc_id: exampleDoc?.id ?? null });
      });
    sendJson(res, 200, rows);
    return;
  }
  const { rows } = await getPool().query<{
    id: string; org_id: string; form_type: string; schema_json: Array<{key:string;label:string;sample:string}>;
    status: string; created_at: string; example_doc_id: string | null;
  }>(
    `SELECT t.id, t.org_id, t.form_type, t.schema_json, t.status, t.created_at,
            (SELECT d.id FROM documents d WHERE d.org_id = t.org_id AND d.doc_type = t.form_type LIMIT 1) AS example_doc_id
     FROM templates t WHERE t.org_id = $1 ORDER BY t.created_at DESC`,
    [ORG_ID],
  );
  sendJson(res, 200, rows.map(r => mapTemplate(r)));
}

async function handleApproveTemplateEndpoint(res: http.ServerResponse, tplId: string, subject: AccessSubject): Promise<void> {
  await enforceAccess(subject, { capability: 'approve_templates', targetTable: 'templates', targetId: tplId });
  const updated = await doApproveTemplate(tplId);
  if (!updated) {
    // Already approved — fetch and return current state
    const tpl = await getTemplate(tplId);
    if (!tpl) { sendJson(res, 404, { error: 'template not found' }); return; }
    sendJson(res, 200, mapTemplate({ ...tpl, example_doc_id: null }));
    return;
  }
  sendJson(res, 200, mapTemplate({ ...updated, example_doc_id: null }));
}

async function handleGetLeadershipSummary(res: http.ServerResponse, subject: AccessSubject): Promise<void> {
  await enforceAccess(subject, { capability: 'view_aggregate_reports', targetTable: 'transactions', targetId: ORG_ID });
  if (IS_MOCK) {
    const db = readAgentMock();
    const txns = db.transactions.filter(t => t.org_id === ORG_ID);
    const byCat = new Map<string, { total_cents: number; txn_count: number }>();
    let total = 0; let pending = 0;
    for (const t of txns) {
      total += t.amount_cents;
      if (t.status === 'pending_review') pending++;
      const existing = byCat.get(t.category);
      if (existing) { existing.total_cents += t.amount_cents; existing.txn_count++; }
      else byCat.set(t.category, { total_cents: t.amount_cents, txn_count: 1 });
    }
    const monthly = new Map<string, number>();
    for (const t of txns) {
      const m = t.txn_date.slice(0, 7);
      monthly.set(m, (monthly.get(m) ?? 0) + t.amount_cents);
    }
    sendJson(res, 200, {
      org_id: ORG_ID,
      period_label: 'YTD',
      total_spend_cents: total,
      txn_count: txns.length,
      pending_review_count: pending,
      by_category: Array.from(byCat.entries()).map(([category, v]) => ({ category, ...v })),
      monthly_spend_cents: Array.from(monthly.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, total_cents]) => ({ month, total_cents })),
    });
    return;
  }
  const pool = getPool();
  const [catRes, monthRes, pendRes] = await Promise.all([
    pool.query<{category:string;total_cents:string|number;txn_count:string|number}>(
      `SELECT category, SUM(amount_cents)::int AS total_cents, COUNT(*)::int AS txn_count
       FROM transactions WHERE org_id = $1 GROUP BY category ORDER BY SUM(amount_cents) DESC`, [ORG_ID],
    ),
    pool.query<{month:string;total_cents:string|number}>(
      `SELECT TO_CHAR(txn_date::date, 'YYYY-MM') AS month, SUM(amount_cents)::int AS total_cents
       FROM transactions WHERE org_id = $1 GROUP BY 1 ORDER BY 1`, [ORG_ID],
    ),
    pool.query<{total:string|number;pending:string|number}>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status='pending_review')::int AS pending
       FROM transactions WHERE org_id = $1`, [ORG_ID],
    ),
  ]);
  // pg returns int8 (SUM/COUNT results) as strings to avoid JS precision loss; parse explicitly.
  const n = (v: string | number) => parseInt(String(v), 10) || 0;
  const agg = catRes.rows;
  const totalSpend = agg.reduce((s, r) => s + n(r.total_cents), 0);
  sendJson(res, 200, {
    org_id: ORG_ID,
    period_label: 'YTD',
    total_spend_cents: totalSpend,
    txn_count: n(pendRes.rows[0]?.total ?? 0),
    pending_review_count: n(pendRes.rows[0]?.pending ?? 0),
    by_category: agg.map(r => ({ category: r.category, total_cents: n(r.total_cents), txn_count: n(r.txn_count) })),
    monthly_spend_cents: monthRes.rows.map(r => ({ month: r.month, total_cents: n(r.total_cents) })),
  });
}

async function handleGetActivity(res: http.ServerResponse): Promise<void> {
  if (IS_MOCK) {
    const db = readAgentMock();
    const events = db.audit_log
      .filter(e => e.org_id === ORG_ID && AUDIT_TO_ACTIVITY[e.action])
      .slice(0, 50)
      .map(e => ({
        id: e.id,
        org_id: e.org_id,
        actor: e.actor_id === 'cli-system' ? 'Fiscus Agent' : e.actor_id,
        is_agent: e.actor_id === 'cli-system',
        action: AUDIT_TO_ACTIVITY[e.action],
        detail: buildActivityDetail(e.action, e.detail_json),
        created_at: e.created_at,
      }));
    sendJson(res, 200, events);
    return;
  }
  const { rows } = await getPool().query<{
    id:string; org_id:string; actor_id:string; action:string; detail_json:Record<string,unknown>; created_at:string;
    display_name:string|null;
  }>(
    `SELECT a.id, a.org_id, a.actor_id, a.action, a.detail_json, a.created_at,
            v.display_name
     FROM audit_log a
     LEFT JOIN volunteers v ON v.id::text = a.actor_id AND v.org_id = a.org_id
     WHERE a.org_id = $1 AND a.action = ANY($2::text[])
     ORDER BY a.created_at DESC LIMIT 100`,
    [ORG_ID, Object.keys(AUDIT_TO_ACTIVITY)],
  );
  sendJson(res, 200, rows.map(r => ({
    id: r.id,
    org_id: r.org_id,
    actor: r.display_name ?? (r.actor_id === 'cli-system' ? 'Fiscus Agent' : r.actor_id),
    is_agent: r.actor_id === 'cli-system' || r.actor_id === 'seed-script',
    action: AUDIT_TO_ACTIVITY[r.action],
    detail: buildActivityDetail(r.action, r.detail_json),
    created_at: r.created_at,
  })));
}

function buildActivityDetail(action: string, detail: Record<string, unknown>): string {
  switch (action) {
    case 'template_generated': return `Generated template for ${String(detail.form_type ?? 'unknown')}`;
    case 'template_approved':  return `Approved template for ${String(detail.form_type ?? 'unknown')}`;
    case 'document_uploaded':  return `Document uploaded`;
    case 'transaction_extracted':
    case 'fields_extracted':   return `Fields extracted`;
    case 'correction_applied': return `Correction: ${String(detail.field ?? '')} → ${String(detail.corrected_value ?? '')}`;
    case 'transaction_approved': return `Transaction approved`;
    default: return action;
  }
}

async function handleGetLearnedCorrections(res: http.ServerResponse): Promise<void> {
  if (IS_MOCK) {
    const db = readAgentMock();
    const corrections = db.corrections ?? [];
    sendJson(res, 200, corrections.filter(c => c.org_id === ORG_ID).map(c => ({
      id: c.id,
      org_id: c.org_id,
      doc_type: 'unknown',
      field: c.field,
      learned_rule: `${c.field}: '${c.original_value}' → '${c.corrected_value}'`,
      times_applied: 1,
      last_applied: c.created_at,
    })));
    return;
  }
  const { rows } = await getPool().query<{
    id:string; org_id:string; doc_type:string; field:string;
    original_value:string; corrected_value:string; created_at:string; times_applied:number;
  }>(
    `SELECT c.id, c.org_id, d.doc_type, c.field, c.original_value, c.corrected_value, c.created_at,
            COUNT(*) OVER (PARTITION BY c.field, c.corrected_value)::int AS times_applied
     FROM corrections c
     JOIN transactions t ON t.id = c.transaction_id AND t.org_id = c.org_id
     JOIN documents d ON d.id = t.document_id AND d.org_id = c.org_id
     WHERE c.org_id = $1
     ORDER BY c.created_at DESC`,
    [ORG_ID],
  );
  sendJson(res, 200, rows.map(r => ({
    id: r.id,
    org_id: r.org_id,
    doc_type: r.doc_type,
    field: r.field,
    learned_rule: `${r.field}: '${r.original_value}' → '${r.corrected_value}'`,
    times_applied: r.times_applied,
    last_applied: r.created_at,
  })));
}

async function handleAskAgent(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const { question } = await readBody<{ question: string }>(req);
  const resp = await ask(question);
  sendJson(res, 200, {
    role: 'agent',
    text: resp.answer,
    citations: resp.citations.map(c => `${c.category}: ${c.detail}`),
  });
}

async function handleSearch(res: http.ServerResponse, query: string, subject: AccessSubject): Promise<void> {
  await enforceAccess(subject, { capability: 'view_row_level_transactions', targetTable: 'transactions', targetId: query });
  const embedding = await embed(query);
  if (IS_MOCK) {
    const db = readAgentMock();
    const txns = db.transactions.filter(t => t.org_id === ORG_ID).slice(0, 5);
    const docs = db.documents;
    sendJson(res, 200, txns.map((t, i) => {
      const doc = docs.find(d => d.id === t.document_id);
      return {
        transaction_id: t.id,
        document_id: t.document_id,
        doc_name: doc?.s3_key ?? t.document_id,
        doc_type: doc?.doc_type ?? 'unknown',
        category: t.category,
        amount_cents: t.amount_cents,
        txn_date: t.txn_date,
        snippet: `${t.category} — $${(t.amount_cents / 100).toFixed(2)}`,
        score: parseFloat((0.9 - i * 0.1).toFixed(2)),
      };
    }));
    return;
  }
  const { rows } = await getPool().query<{
    transaction_id:string; document_id:string; doc_name:string; doc_type:string;
    category:string; amount_cents:number; txn_date:string; distance:number;
  }>(
    `SELECT t.id AS transaction_id, t.document_id, d.s3_key AS doc_name, d.doc_type,
            t.category, t.amount_cents, t.txn_date,
            (t.embedding <-> $1) AS distance
     FROM transactions t JOIN documents d ON d.id = t.document_id
     WHERE t.org_id = $2
     ORDER BY t.embedding <-> $1 LIMIT 10`,
    [JSON.stringify(embedding), ORG_ID],
  );
  sendJson(res, 200, rows.map(r => ({
    transaction_id: r.transaction_id,
    document_id: r.document_id,
    doc_name: r.doc_name,
    doc_type: r.doc_type,
    category: r.category,
    amount_cents: r.amount_cents,
    txn_date: typeof r.txn_date === 'string' ? r.txn_date.slice(0, 10) : r.txn_date,
    snippet: `${r.category} — $${(r.amount_cents / 100).toFixed(2)}`,
    score: parseFloat((1.0 / (1.0 + r.distance)).toFixed(4)),
  })));
}

async function handleGetSession(res: http.ServerResponse, subject: AccessSubject): Promise<void> {
  if (IS_MOCK) { send204(res); return; }
  const { rows } = await getPool().query<{
    id:string; volunteer_id:string; pending_documents:{conversation?:unknown[]};
    current_index:number; updated_at:string;
  }>(
    'SELECT id, volunteer_id, pending_documents, current_index, updated_at FROM sessions WHERE org_id = $1 AND volunteer_id = $2 ORDER BY updated_at DESC LIMIT 1',
    [ORG_ID, subject.volunteerId],
  );
  if (!rows[0]) { send204(res); return; }
  const s = rows[0];
  sendJson(res, 200, {
    id: s.id,
    volunteer_id: s.volunteer_id,
    pending_document_ids: [],
    current_index: s.current_index,
    updated_at: s.updated_at,
  });
}

async function handleUploadDocument(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  sendJson(res, 501, { error: 'uploadDocument not yet implemented — use the CLI embed:file command' });
}

// ── Router ────────────────────────────────────────────────────────────────────
// Exported so CI tests can drive the routing/RBAC/mapping logic over a real
// http.Server on an ephemeral port without depending on the module's own
// auto-listen below (see the `!process.env.VITEST` guard).
export async function router(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const urlObj = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const p = urlObj.pathname.replace(/\/$/, '') || '/';
  const method = req.method?.toUpperCase() ?? 'GET';

  setCors(req, res);

  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const subject = buildSubject(req);

  try {
    // Static routes
    if (method === 'GET'  && p === '/org')               { await handleGetOrg(res); return; }
    if (method === 'GET'  && p === '/volunteers')         { await handleGetVolunteers(res); return; }
    if (method === 'GET'  && p === '/documents')          { await handleListDocuments(res); return; }
    if (method === 'POST' && p === '/documents')          { await handleUploadDocument(req, res); return; }
    if (method === 'POST' && p === '/corrections')        { await handleApplyCorrection(req, res, subject); return; }
    if (method === 'GET'  && p === '/corrections/learned'){ await handleGetLearnedCorrections(res); return; }
    if (method === 'GET'  && p === '/templates')          { await handleListTemplates(res); return; }
    if (method === 'GET'  && p === '/summary')            { await handleGetLeadershipSummary(res, subject); return; }
    if (method === 'GET'  && p === '/activity')           { await handleGetActivity(res); return; }
    if (method === 'POST' && p === '/agent/ask')          { await handleAskAgent(req, res); return; }
    if (method === 'GET'  && p === '/search')             { await handleSearch(res, urlObj.searchParams.get('q') ?? '', subject); return; }
    if (method === 'GET'  && p === '/session')            { await handleGetSession(res, subject); return; }

    // Parametric routes
    const docTxnMatch = /^\/documents\/([^/]+)\/transaction$/.exec(p);
    if (method === 'GET' && docTxnMatch) {
      await handleGetTransactionForDoc(res, docTxnMatch[1], subject); return;
    }
    const approveTxnMatch = /^\/transactions\/([^/]+)\/approve$/.exec(p);
    if (method === 'POST' && approveTxnMatch) {
      await handleApproveTransaction(res, approveTxnMatch[1], subject); return;
    }
    const approveTplMatch = /^\/templates\/([^/]+)\/approve$/.exec(p);
    if (method === 'POST' && approveTplMatch) {
      await handleApproveTemplateEndpoint(res, approveTplMatch[1], subject); return;
    }

    sendJson(res, 404, { error: `${method} ${p} not found` });
  } catch (err) {
    if (err instanceof Error && err.name === 'AccessDeniedError') {
      sendJson(res, 403, { error: 'forbidden', detail: err.message }); return;
    }
    console.error('[server]', err);
    sendJson(res, 500, { error: 'internal server error' });
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
// Vitest sets process.env.VITEST=true automatically; skip auto-listen when this
// module is imported for its `router` export in tests (they build their own
// http.Server on an ephemeral port instead). `npm run api:serve` runs outside
// vitest, so this guard never affects real usage.
if (!process.env.VITEST) {
  const server = http.createServer((req, res) => {
    void router(req, res);
  });

  server.listen(PORT, () => {
    console.log(`[fiscus-api] listening on http://localhost:${PORT}`);
    console.log(`[fiscus-api] mode: ${IS_MOCK ? 'MOCK (no DB/AWS creds)' : 'REAL (CockroachDB + AWS)'}`);
    console.log(`[fiscus-api] org: ${ORG_ID}`);
  });
}
