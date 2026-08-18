// Data access for the pieces of the FiscusApi contract that have no
// existing dedicated module to delegate to (org/volunteers/documents/
// transactions/corrections/templates/activity). Mirrors the IS_MOCK / real
// pg pool pattern used by every other client.ts in this repo.
//
// Template generation/approval logic intentionally is NOT imported from
// services/ingestion/template-gen/src/approve.ts here, even though that
// would otherwise be the natural "delegate, don't reimplement" choice:
// that module pins its own zod ^3 in a package-local package.json/
// node_modules specifically because root uses zod ^4 (see its
// tsconfig.json's `extends` + isolated deps). Importing its source into a
// file compiled under the ROOT tsconfig (as services/api/src is) would
// require `npm install` inside services/ingestion/template-gen just for
// root `tsc`/CI to resolve its types — reintroducing the exact conflict
// that module's isolation exists to avoid. The template approve/list logic
// below is small enough (get → check → flip status → audit) that
// duplicating it locally, using the same audit action name
// ('template_approved') the CLI module uses, is the pragmatic trade-off.

import { randomUUID } from 'crypto';
import { logAction } from '../../../lib/audit';
import { redact } from '../../../lib/redact';
import {
  IS_MOCK, ORG_ID, getPool, readMockDb, writeMockDb, isUuid,
  type MockDocument, type MockTransaction, type MockTemplate, type MockCorrection,
} from './env';

export { IS_MOCK, ORG_ID };

// ── Organization / volunteers ─────────────────────────────────────────────
export interface OrgRow { id: string; name: string; retention_years: number; created_at: string; }
export interface VolunteerRow {
  id: string; org_id: string; role: 'data_entry' | 'reviewer' | 'treasurer' | 'leadership'; display_name: string;
}

export async function getOrg(): Promise<OrgRow> {
  if (IS_MOCK) {
    const db = readMockDb();
    return db.organizations[0] ?? {
      id: ORG_ID, name: 'Green Paws Rescue', retention_years: 7, created_at: '2021-03-01T00:00:00Z',
    };
  }
  const result = await getPool().query<OrgRow>('SELECT id, name, retention_years, created_at FROM organizations WHERE id = $1', [ORG_ID]);
  if (!result.rows[0]) throw new Error('organization not found');
  // CockroachDB's INT is 64-bit by default, so node-postgres reports it via
  // the int8 OID and returns it as a STRING (to avoid silent precision
  // loss above Number.MAX_SAFE_INTEGER) — confirmed live against the real
  // cluster: retention_years came back as "7", not 7. Coerce explicitly
  // rather than trust the driver to match the TS type.
  return { ...result.rows[0], retention_years: Number(result.rows[0].retention_years) };
}

export async function listVolunteers(): Promise<VolunteerRow[]> {
  if (IS_MOCK) return readMockDb().volunteers;
  const result = await getPool().query<VolunteerRow>('SELECT id, org_id, role, display_name FROM volunteers WHERE org_id = $1', [ORG_ID]);
  return result.rows;
}

export async function getVolunteer(id: string): Promise<VolunteerRow | null> {
  if (IS_MOCK) return readMockDb().volunteers.find((v) => v.id === id) ?? null;
  if (!isUuid(id)) return null;
  const result = await getPool().query<VolunteerRow>('SELECT id, org_id, role, display_name FROM volunteers WHERE id = $1 AND org_id = $2', [id, ORG_ID]);
  return result.rows[0] ?? null;
}

// ── Documents ────────────────────────────────────────────────────────────
export async function listDocuments(): Promise<MockDocument[]> {
  if (IS_MOCK) {
    return [...readMockDb().documents].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  const result = await getPool().query<MockDocument>(
    'SELECT id, org_id, s3_key, doc_type, status, uploaded_by, created_at FROM documents WHERE org_id = $1 ORDER BY created_at DESC',
    [ORG_ID],
  );
  return result.rows;
}

export async function getDocument(id: string): Promise<MockDocument | null> {
  if (IS_MOCK) return readMockDb().documents.find((d) => d.id === id) ?? null;
  if (!isUuid(id)) return null;
  const result = await getPool().query<MockDocument>(
    'SELECT id, org_id, s3_key, doc_type, status, uploaded_by, created_at FROM documents WHERE id = $1 AND org_id = $2',
    [id, ORG_ID],
  );
  return result.rows[0] ?? null;
}

// Demo-scope "upload": registers a document row directly (no S3 round trip —
// the FiscusApi.uploadDocument contract only takes { name, doc_type }, no
// file bytes). Real ingestion of raw bytes is services/ingestion/s3-extraction's
// createUpload() flow; this is the lightweight metadata-only path the UI's
// upload form actually calls.
export async function insertDocument(name: string, docType: string, uploadedBy: string): Promise<MockDocument> {
  const id = randomUUID();
  const now = new Date().toISOString();
  // Belt-and-suspenders redaction (AGENTS.md §5.1: card numbers never
  // written to CockroachDB) on the one piece of free-text a caller controls
  // here. The bulk of extraction-time redaction happens upstream in
  // services/ingestion/s3-extraction (Track A's Lambda step); this route
  // only ever receives a filename + doc_type, not document body text, but
  // redacting before persisting is unconditional per §5.1, not "only when
  // the field looks risky."
  const safeName = redact(name);
  const row: MockDocument = {
    id, org_id: ORG_ID, s3_key: `s3://fiscus-demo/${ORG_ID}/${id}-${safeName}`,
    doc_type: docType, status: 'needs_review', uploaded_by: uploadedBy, created_at: now,
  };
  if (IS_MOCK) {
    const db = readMockDb();
    db.documents.push(row);
    writeMockDb(db);
  } else {
    await getPool().query(
      `INSERT INTO documents (id, org_id, s3_key, doc_type, status, uploaded_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [row.id, row.org_id, row.s3_key, row.doc_type, row.status, row.uploaded_by, row.created_at],
    );
  }
  await logAction(ORG_ID, uploadedBy, 'document_uploaded', 'documents', id, { s3_key: row.s3_key, doc_type: docType });
  return row;
}

// ── Transactions ─────────────────────────────────────────────────────────
export async function getTransactionForDocument(documentId: string): Promise<MockTransaction | null> {
  if (IS_MOCK) return readMockDb().transactions.find((t) => t.document_id === documentId) ?? null;
  if (!isUuid(documentId)) return null;
  const result = await getPool().query(
    `SELECT id, org_id, document_id, category, amount_cents, currency, txn_date, extracted_fields_json, status, created_at
     FROM transactions WHERE document_id = $1 AND org_id = $2`,
    [documentId, ORG_ID],
  );
  const row = result.rows[0];
  if (!row) return null;
  // See getOrg()'s comment: CockroachDB's INT is 64-bit, so node-postgres
  // hands back amount_cents as a string. Cent amounts here stay well under
  // Number.MAX_SAFE_INTEGER for any real nonprofit's books, so a plain
  // Number() coercion (not BigInt) is safe and matches the frontend's
  // `amount_cents: number` contract.
  return { ...row, amount_cents: Number(row.amount_cents), extracted_fields: row.extracted_fields_json ?? [] } as MockTransaction;
}

export async function getTransaction(id: string): Promise<MockTransaction | null> {
  if (IS_MOCK) return readMockDb().transactions.find((t) => t.id === id) ?? null;
  if (!isUuid(id)) return null;
  const result = await getPool().query(
    `SELECT id, org_id, document_id, category, amount_cents, currency, txn_date, extracted_fields_json, status, created_at
     FROM transactions WHERE id = $1 AND org_id = $2`,
    [id, ORG_ID],
  );
  const row = result.rows[0];
  if (!row) return null;
  row.amount_cents = Number(row.amount_cents);
  return { ...row, extracted_fields: row.extracted_fields_json ?? [] } as MockTransaction;
}

export async function applyCorrection(input: {
  transaction_id: string; field: string; original_value: string; corrected_value: string; correctedBy: string;
}): Promise<MockCorrection> {
  // Belt-and-suspenders redaction (AGENTS.md §5.1) — a volunteer-typed
  // correction is free text and could contain a pasted card number; redact
  // unconditionally before it's ever written to the corrections table.
  const originalValue = redact(input.original_value);
  const correctedValue = redact(input.corrected_value);
  const correction: MockCorrection = {
    id: randomUUID(), org_id: ORG_ID, transaction_id: input.transaction_id, field: input.field,
    original_value: originalValue, corrected_value: correctedValue,
    corrected_by: input.correctedBy, created_at: new Date().toISOString(),
  };
  if (IS_MOCK) {
    const db = readMockDb();
    db.corrections.push(correction);
    const txn = db.transactions.find((t) => t.id === input.transaction_id);
    if (txn) {
      const f = txn.extracted_fields.find((x) => x.key === input.field);
      if (f) { f.value = correctedValue; f.confidence = 1; }
    }
    writeMockDb(db);
  } else {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO corrections (id, org_id, transaction_id, field, original_value, corrected_value, corrected_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [correction.id, correction.org_id, correction.transaction_id, correction.field, correction.original_value, correction.corrected_value, correction.corrected_by, correction.created_at],
      );
      const txnResult = await client.query('SELECT extracted_fields_json FROM transactions WHERE id = $1 AND org_id = $2', [input.transaction_id, ORG_ID]);
      const fields = (txnResult.rows[0]?.extracted_fields_json ?? []) as { key: string; label: string; value: string; confidence: number }[];
      const updated = fields.map((f) => (f.key === input.field ? { ...f, value: correctedValue, confidence: 1 } : f));
      await client.query('UPDATE transactions SET extracted_fields_json = $1 WHERE id = $2 AND org_id = $3', [JSON.stringify(updated), input.transaction_id, ORG_ID]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  await logAction(ORG_ID, input.correctedBy, 'correction_applied', 'transactions', input.transaction_id, {
    field: input.field, original_value: originalValue, corrected_value: correctedValue,
  });
  return correction;
}

export async function approveTransaction(id: string, actorId: string): Promise<MockTransaction> {
  if (IS_MOCK) {
    const db = readMockDb();
    const txn = db.transactions.find((t) => t.id === id);
    if (!txn) throw new Error(`transaction ${id} not found`);
    txn.status = 'approved';
    const doc = db.documents.find((d) => d.id === txn.document_id);
    if (doc) doc.status = 'approved';
    writeMockDb(db);
    await logAction(ORG_ID, actorId, 'transaction_approved', 'transactions', id, {});
    return txn;
  }
  if (!isUuid(id)) throw new Error(`transaction ${id} not found`);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE transactions SET status = 'approved' WHERE id = $1 AND org_id = $2
       RETURNING id, org_id, document_id, category, amount_cents, currency, txn_date, extracted_fields_json, status, created_at`,
      [id, ORG_ID],
    );
    if (result.rows.length === 0) throw new Error(`transaction ${id} not found`);
    const row = result.rows[0];
    await client.query(`UPDATE documents SET status = 'approved' WHERE id = $1 AND org_id = $2`, [row.document_id, ORG_ID]);
    await client.query('COMMIT');
    await logAction(ORG_ID, actorId, 'transaction_approved', 'transactions', id, {});
    return { ...row, extracted_fields: row.extracted_fields_json ?? [] } as MockTransaction;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Templates ────────────────────────────────────────────────────────────
export async function listTemplates(): Promise<MockTemplate[]> {
  if (IS_MOCK) return readMockDb().templates;
  const result = await getPool().query('SELECT id, org_id, form_type, schema_json, status, created_at FROM templates WHERE org_id = $1', [ORG_ID]);
  return result.rows.map((r) => ({
    id: r.id, org_id: r.org_id, form_type: r.form_type, status: r.status,
    fields: (r.schema_json ?? []).map((f: { key: string; label: string; sample: string }) => ({ key: f.key, label: f.label, type: 'string', sample: f.sample })),
    example_doc_id: '', created_at: r.created_at,
  }));
}

export async function getTemplate(id: string): Promise<MockTemplate | null> {
  if (IS_MOCK) return readMockDb().templates.find((t) => t.id === id) ?? null;
  if (!isUuid(id)) return null;
  const result = await getPool().query('SELECT id, org_id, form_type, schema_json, status, created_at FROM templates WHERE id = $1 AND org_id = $2', [id, ORG_ID]);
  const r = result.rows[0];
  if (!r) return null;
  return {
    id: r.id, org_id: r.org_id, form_type: r.form_type, status: r.status,
    fields: (r.schema_json ?? []).map((f: { key: string; label: string; sample: string }) => ({ key: f.key, label: f.label, type: 'string', sample: f.sample })),
    example_doc_id: '', created_at: r.created_at,
  };
}

export async function approveTemplateById(id: string, actorId: string): Promise<MockTemplate> {
  const existing = await getTemplate(id);
  if (!existing) throw new Error(`template ${id} not found`);
  if (existing.status === 'approved') return existing;

  if (IS_MOCK) {
    const db = readMockDb();
    const row = db.templates.find((t) => t.id === id)!;
    row.status = 'approved';
    writeMockDb(db);
  } else {
    await getPool().query(`UPDATE templates SET status = 'approved' WHERE id = $1 AND org_id = $2`, [id, ORG_ID]);
  }
  await logAction(ORG_ID, actorId, 'template_approved', 'templates', id, { form_type: existing.form_type });
  return { ...existing, status: 'approved' };
}

// ── Activity feed (audit_log consumer, per FiscusApi's comment) ──────────
export interface ActivityEventRow {
  id: string; org_id: string; actor: string; is_agent: boolean;
  action: string; detail: string; created_at: string;
}

// Only these audit actions map onto the frontend's closed ActivityAction
// union; other audited actions (access_denied, agent_answered,
// summary_generated, …) are real audit rows but not "activity feed" items.
const ACTIVITY_ACTIONS = new Set([
  'document_uploaded', 'fields_extracted', 'extraction_saved', 'correction_applied',
  'transaction_approved', 'template_generated', 'template_approved',
]);
const ACTION_ALIAS: Record<string, string> = { extraction_saved: 'fields_extracted' };

export async function getActivity(limit = 20): Promise<ActivityEventRow[]> {
  const volunteers = await listVolunteers();
  const byId = new Map(volunteers.map((v) => [v.id, v.display_name]));

  let rows: { id: string; org_id: string; actor_id: string; action: string; target_table: string; target_id: string; detail_json: Record<string, unknown>; created_at: string }[];
  if (IS_MOCK) {
    rows = [...readMockDb().audit_log].sort((a, b) => b.created_at.localeCompare(a.created_at));
  } else {
    const result = await getPool().query(
      'SELECT id, org_id, actor_id, action, target_table, target_id, detail_json, created_at FROM audit_log WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2',
      [ORG_ID, limit],
    );
    rows = result.rows;
  }

  return rows
    .filter((r) => ACTIVITY_ACTIONS.has(r.action))
    .slice(0, limit)
    .map((r) => {
      const isAgent = r.actor_id === 'cli-system' || r.actor_id.startsWith('cli-') || r.actor_id === 'agent';
      return {
        id: r.id, org_id: r.org_id,
        actor: isAgent ? 'Fiscus Agent' : (byId.get(r.actor_id) ?? r.actor_id),
        is_agent: isAgent,
        action: ACTION_ALIAS[r.action] ?? r.action,
        detail: `${ACTION_ALIAS[r.action] ?? r.action} on ${r.target_table}:${r.target_id}`,
        created_at: r.created_at,
      };
    });
}

// ── Learned corrections (agent memory made visible) ───────────────────────
// No generalization engine exists yet (that's a future-facing AI feature);
// this honestly aggregates the raw `corrections` history into the shape the
// UI expects rather than fabricating rules it can't actually verify.
export interface LearnedCorrectionRow {
  id: string; org_id: string; doc_type: string; field: string; learned_rule: string;
  times_applied: number; last_applied: string;
}

export async function getLearnedCorrections(): Promise<LearnedCorrectionRow[]> {
  const corrections: MockCorrection[] = IS_MOCK
    ? readMockDb().corrections
    : (await getPool().query<MockCorrection>('SELECT id, org_id, transaction_id, field, original_value, corrected_value, corrected_by, created_at FROM corrections WHERE org_id = $1', [ORG_ID])).rows;

  const byKey = new Map<string, { field: string; original_value: string; corrected_value: string; count: number; last: string }>();
  for (const c of corrections) {
    const key = `${c.field}::${c.original_value}::${c.corrected_value}`;
    const existing = byKey.get(key);
    if (existing) { existing.count += 1; if (c.created_at > existing.last) existing.last = c.created_at; }
    else byKey.set(key, { field: c.field, original_value: c.original_value, corrected_value: c.corrected_value, count: 1, last: c.created_at });
  }
  return Array.from(byKey.entries()).map(([key, v]) => ({
    id: key, org_id: ORG_ID, doc_type: 'unknown', field: v.field,
    learned_rule: `'${v.original_value}' -> '${v.corrected_value}'`,
    times_applied: v.count, last_applied: v.last,
  }));
}

// ── Review session (derived, not persisted — see services/agent's own
// `sessions` table, which C1 already repurposes for Q&A conversation
// history; layering a second meaning onto that table would compound the
// documented schema smell instead of fixing it). This mirrors mock.ts's
// behavior: a volunteer's pending-review queue, computed on read. ─────────
export interface ReviewSessionRow {
  id: string; volunteer_id: string; pending_document_ids: string[]; current_index: number; updated_at: string;
}

export async function getReviewSessionForVolunteer(volunteerId: string): Promise<ReviewSessionRow | null> {
  const docs = await listDocuments();
  const pending = docs.filter((d) => d.status === 'needs_review').map((d) => d.id);
  if (pending.length === 0) return null;
  return {
    id: `sess_${volunteerId}`, volunteer_id: volunteerId,
    pending_document_ids: pending, current_index: 0, updated_at: new Date().toISOString(),
  };
}

// ── Leadership aggregates (RBAC-safe: GROUP BY only, no row-level SELECT) ─
export interface CategoryTotalRow { category: string; total_cents: number; txn_count: number; }
export interface MonthlyTotalRow { month: string; total_cents: number; }

export async function getCategoryTotals(): Promise<CategoryTotalRow[]> {
  if (IS_MOCK) {
    const db = readMockDb();
    const map = new Map<string, CategoryTotalRow>();
    for (const t of db.transactions) {
      const existing = map.get(t.category);
      if (existing) { existing.total_cents += t.amount_cents; existing.txn_count += 1; }
      else map.set(t.category, { category: t.category, total_cents: t.amount_cents, txn_count: 1 });
    }
    return Array.from(map.values()).sort((a, b) => b.total_cents - a.total_cents);
  }
  const result = await getPool().query<CategoryTotalRow>(
    `SELECT category, SUM(amount_cents)::int AS total_cents, COUNT(*)::int AS txn_count
     FROM transactions WHERE org_id = $1 GROUP BY category ORDER BY SUM(amount_cents) DESC`,
    [ORG_ID],
  );
  // Both columns come back as strings despite the ::int cast (CockroachDB's
  // INT is 64-bit — see getOrg()'s comment); coerce so callers summing
  // these (e.g. the /api/summary route's total_spend_cents) get real
  // addition instead of string concatenation. Caught live: an uncoerced
  // response produced total_spend_cents = "0192769168000500002540121460".
  return result.rows.map((r) => ({ ...r, total_cents: Number(r.total_cents), txn_count: Number(r.txn_count) }));
}

export async function getMonthlyTotals(): Promise<MonthlyTotalRow[]> {
  if (IS_MOCK) {
    const db = readMockDb();
    const map = new Map<string, number>();
    for (const t of db.transactions) {
      const month = t.txn_date.slice(0, 7);
      map.set(month, (map.get(month) ?? 0) + t.amount_cents);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([month, total_cents]) => ({ month, total_cents }));
  }
  const result = await getPool().query<MonthlyTotalRow>(
    `SELECT to_char(date_trunc('month', txn_date::date), 'YYYY-MM') AS month, SUM(amount_cents)::int AS total_cents
     FROM transactions WHERE org_id = $1 GROUP BY 1 ORDER BY 1`,
    [ORG_ID],
  );
  return result.rows.map((r) => ({ ...r, total_cents: Number(r.total_cents) }));
}

export async function getPendingReviewCount(): Promise<number> {
  const docs = await listDocuments();
  return docs.filter((d) => d.status === 'needs_review').length;
}
