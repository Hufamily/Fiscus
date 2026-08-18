// Route wiring for the FiscusApi HTTP contract (services/web/src/api/client.ts).
// Every route: resolveActor() (who's asking) -> requireCapability()/enforceAccess()
// (AGENTS.md §5.3, lib/rbac.ts) -> delegate to db.ts or the existing
// agent/embeddings/summaries modules -> JSON response shaped to match the
// frontend's src/types.ts exactly.

import { Router, type Response, type NextFunction } from 'express';
import { requireCapability, enforceAccess, AccessDeniedError, type AccessRequest } from '../../../lib/rbac';
import { embed } from '../../../lib/embeddings';
import { ask } from '../../../services/agent/src/agent';
import { searchTransactions as searchTransactionEmbeddings } from '../../../services/ingestion/embeddings/src/client';
import { generateSummary } from '../summaries/src/generate';
import { resolveActor, type AuthedRequest } from './auth';
import * as db from './db';

export const router = Router();

router.use(resolveActor);

function wrap(fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<void>) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

function cap(toRequest: (req: AuthedRequest) => AccessRequest) {
  return requireCapability<AuthedRequest>(toRequest);
}

// ── Org / volunteers (open to any authenticated volunteer) ────────────────
router.get('/org', wrap(async (_req, res) => {
  res.json(await db.getOrg());
}));

router.get('/volunteers', wrap(async (_req, res) => {
  res.json(await db.listVolunteers());
}));

// ── Documents ───────────────────────────────────────────────────────────
router.get(
  '/documents',
  cap(() => ({ capability: 'view_row_level_transactions', targetTable: 'documents', targetId: 'list' })),
  wrap(async (_req, res) => {
    res.json(await db.listDocuments());
  }),
);

router.post(
  '/documents',
  // A volunteer can only ever upload as themselves, so the ownership check
  // (data_entry -> own uploads only) is always self-satisfied here.
  cap((req) => ({ capability: 'upload_documents', targetTable: 'documents', targetId: 'new', uploadedBy: req.volunteer!.volunteerId })),
  wrap(async (req, res) => {
    const { name, doc_type } = req.body as { name?: string; doc_type?: string };
    if (!name || !doc_type) { res.status(400).json({ error: 'name and doc_type are required' }); return; }
    const doc = await db.insertDocument(name, doc_type, req.volunteer!.volunteerId);
    res.status(201).json(doc);
  }),
);

router.get(
  '/documents/:id/transaction',
  cap((req) => ({ capability: 'view_row_level_transactions', targetTable: 'transactions', targetId: req.params.id })),
  wrap(async (req, res) => {
    const txn = await db.getTransactionForDocument(req.params.id);
    if (!txn) { res.status(204).end(); return; }
    res.json(txn);
  }),
);

// ── Corrections (data_entry: own uploads only; needs an async lookup, so
// this is enforced inline with enforceAccess rather than via the
// requireCapability middleware, whose toRequest() is synchronous). ────────
router.post('/corrections', wrap(async (req, res) => {
  const { transaction_id, field, original_value, corrected_value } = req.body as {
    transaction_id?: string; field?: string; original_value?: string; corrected_value?: string;
  };
  if (!transaction_id || !field || corrected_value === undefined) {
    res.status(400).json({ error: 'transaction_id, field, and corrected_value are required' });
    return;
  }

  const txn = await db.getTransaction(transaction_id);
  const doc = txn ? await db.getDocument(txn.document_id) : null;

  try {
    await enforceAccess(req.volunteer!, {
      capability: 'apply_corrections',
      targetTable: 'transactions',
      targetId: transaction_id,
      uploadedBy: doc?.uploaded_by,
    });
  } catch (err) {
    if (err instanceof AccessDeniedError) { res.status(403).json({ error: 'forbidden' }); return; }
    throw err;
  }

  if (!txn) { res.status(404).json({ error: 'transaction not found' }); return; }

  const correction = await db.applyCorrection({
    transaction_id, field, original_value: original_value ?? '', corrected_value,
    correctedBy: req.volunteer!.volunteerId,
  });
  res.status(201).json(correction);
}));

router.post(
  '/transactions/:id/approve',
  cap((req) => ({ capability: 'review_extractions', targetTable: 'transactions', targetId: req.params.id })),
  wrap(async (req, res) => {
    const txn = await db.approveTransaction(req.params.id, req.volunteer!.volunteerId);
    res.json(txn);
  }),
);

// ── Templates ───────────────────────────────────────────────────────────
router.get('/templates', wrap(async (_req, res) => {
  const templates = await db.listTemplates();
  res.json(templates.map((t) => ({ ...t, field_count: t.fields.length })));
}));

router.post(
  '/templates/:id/approve',
  cap((req) => ({ capability: 'approve_templates', targetTable: 'templates', targetId: req.params.id })),
  wrap(async (req, res) => {
    const template = await db.approveTemplateById(req.params.id, req.volunteer!.volunteerId);
    res.json({ ...template, field_count: template.fields.length });
  }),
);

// ── Leadership summary (aggregate-only — AGENTS.md §5.3) ──────────────────
// generateSummary() itself enforces view_aggregate_reports and audits both
// the denial and the success path, so no separate requireCapability call is
// needed on this route; its prose `body` isn't part of the frontend's
// LeadershipSummary contract (see services/web/src/api/http.ts's PR-
// description comment — documented shape mismatch), so we invoke it for its
// RBAC gate + audit + persisted-summary side effect, and build the
// structured response from aggregate-only queries.
router.get('/summary', wrap(async (req, res) => {
  const period = typeof req.query.period === 'string' ? req.query.period : 'YTD';
  try {
    await generateSummary(period, req.volunteer!);
  } catch (err) {
    if (err instanceof AccessDeniedError) { res.status(403).json({ error: 'forbidden' }); return; }
    throw err;
  }

  const [byCategory, monthly, pendingReviewCount] = await Promise.all([
    db.getCategoryTotals(),
    db.getMonthlyTotals(),
    db.getPendingReviewCount(),
  ]);
  const totalSpendCents = byCategory.reduce((sum, c) => sum + c.total_cents, 0);
  const txnCount = byCategory.reduce((sum, c) => sum + c.txn_count, 0);

  res.json({
    org_id: req.volunteer!.orgId,
    period_label: period,
    total_spend_cents: totalSpendCents,
    txn_count: txnCount,
    pending_review_count: pendingReviewCount,
    by_category: byCategory,
    monthly_spend_cents: monthly,
  });
}));

// ── Activity feed / learned corrections (open, informational) ─────────────
router.get('/activity', wrap(async (_req, res) => {
  res.json(await db.getActivity());
}));

router.get('/corrections/learned', wrap(async (_req, res) => {
  res.json(await db.getLearnedCorrections());
}));

// ── Agent Q&A (delegates to services/agent's ask()) ───────────────────────
router.post('/agent/ask', wrap(async (req, res) => {
  const { question } = req.body as { question?: string };
  if (!question) { res.status(400).json({ error: 'question is required' }); return; }
  const response = await ask(question);
  res.json({
    role: 'agent' as const,
    text: response.answer,
    citations: response.citations.map((c) => `${c.category}: ${c.detail}`),
  });
}));

// ── Semantic search (row-level results -> gated the same as row-level
// transaction access, so leadership can't use free-text search to bypass
// the aggregate-only restriction — AGENTS.md §5.3). ────────────────────────
router.get(
  '/search',
  cap(() => ({ capability: 'view_row_level_transactions', targetTable: 'transactions', targetId: 'search' })),
  wrap(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    if (!q.trim()) { res.json([]); return; }

    const queryEmbedding = await embed(q);
    const hits = await searchTransactionEmbeddings(queryEmbedding, 6);

    const results = await Promise.all(hits.map(async (h) => {
      const doc = await db.getDocument(h.document_id);
      // h.distance is L2 (`<->` over vector_l2_ops per AGENTS.md §4), not
      // cosine distance, so it isn't bounded to [0,1] — `1 - distance`
      // clamped to 0 flattened every real result to score 0 (caught live
      // against the real cluster: distances were consistently > 1).
      // 1/(1+distance) is a standard monotonic decreasing-with-distance
      // mapping into (0,1] that doesn't assume a normalized embedding.
      const score = Math.min(0.98, 1 / (1 + Math.max(0, h.distance)));
      return {
        transaction_id: h.id,
        document_id: h.document_id,
        doc_name: doc ? doc.s3_key.split('/').pop() ?? doc.id : h.document_id,
        doc_type: doc?.doc_type ?? h.category,
        category: h.category,
        amount_cents: h.amount_cents,
        txn_date: h.txn_date,
        snippet: doc ? `${doc.doc_type} · ${h.category}` : h.category,
        score,
      };
    }));
    res.json(results);
  }),
);

// ── Review session (derived pending-review queue for the caller) ─────────
router.get('/session', wrap(async (req, res) => {
  const session = await db.getReviewSessionForVolunteer(req.volunteer!.volunteerId);
  if (!session) { res.status(204).end(); return; }
  res.json(session);
}));
