// Port of the Python app/repository.py, minus its own `_log` INSERT INTO
// audit_log — every write here goes through lib/audit.ts's logAction
// instead (AGENTS.md §6: "all writes audit via lib/audit.ts... rather than
// writing to audit_log directly"), which the Python original didn't do.

import { randomUUID } from 'crypto';
import { logAction } from '../../../../lib/audit';
import { IS_MOCK, SYSTEM_ACTOR, getPool, readMockDb, writeMockDb } from './client';
import type { DocumentIdentity, ExtractionResult } from './types';

export async function recordUpload(identity: DocumentIdentity, actorId: string, docType = 'receipt'): Promise<void> {
  if (IS_MOCK) {
    const db = readMockDb();
    if (!db.documents.some((d) => d.id === identity.documentId)) {
      db.documents.push({
        id: identity.documentId,
        org_id: identity.orgId,
        s3_key: identity.s3Key,
        doc_type: docType,
        status: 'uploaded',
        uploaded_by: actorId,
      });
      writeMockDb(db);
    }
  } else {
    await getPool().query(
      `INSERT INTO documents (id, org_id, s3_key, doc_type, status, uploaded_by)
       VALUES ($1,$2,$3,$4,'uploaded',$5) ON CONFLICT (id) DO NOTHING`,
      [identity.documentId, identity.orgId, identity.s3Key, docType, actorId],
    );
  }
  await logAction(identity.orgId, actorId, 'document_uploaded', 'documents', identity.documentId, { s3_key: identity.s3Key });
}

export type SaveExtractionOutcome = 'saved' | 'duplicate';

export async function saveExtraction(identity: DocumentIdentity, extraction: ExtractionResult): Promise<SaveExtractionOutcome> {
  const detailFields = { vendor: extraction.vendor, lineItems: extraction.lineItems };

  if (IS_MOCK) {
    const db = readMockDb();
    const doc = db.documents.find((d) => d.id === identity.documentId && d.org_id === identity.orgId);
    if (!doc) throw new Error('Document was not registered before extraction');
    if (db.transactions.some((t) => t.document_id === identity.documentId && t.org_id === identity.orgId)) {
      return 'duplicate';
    }
    const transactionId = randomUUID();
    db.transactions.push({
      id: transactionId,
      org_id: identity.orgId,
      document_id: identity.documentId,
      category: extraction.category ?? 'uncategorized',
      amount_cents: extraction.amountCents,
      currency: extraction.currency,
      txn_date: extraction.transactionDate,
      extracted_fields_json: detailFields,
      status: 'pending_review',
    });
    doc.status = 'needs_review';
    writeMockDb(db);
    await logAction(identity.orgId, SYSTEM_ACTOR, 'extraction_saved', 'transactions', transactionId, {
      document_id: identity.documentId,
      source: SYSTEM_ACTOR,
    });
    return 'saved';
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const doc = await client.query('SELECT status FROM documents WHERE id = $1 AND org_id = $2 FOR UPDATE', [
      identity.documentId,
      identity.orgId,
    ]);
    if (doc.rowCount === 0) {
      throw new Error('Document was not registered before extraction');
    }
    const existing = await client.query('SELECT 1 FROM transactions WHERE document_id = $1 AND org_id = $2', [
      identity.documentId,
      identity.orgId,
    ]);
    if ((existing.rowCount ?? 0) > 0) {
      await client.query('COMMIT');
      return 'duplicate';
    }
    const transactionId = randomUUID();
    await client.query(
      `INSERT INTO transactions (id, org_id, document_id, category, amount_cents, currency, txn_date, extracted_fields_json, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending_review')`,
      [
        transactionId,
        identity.orgId,
        identity.documentId,
        extraction.category ?? 'uncategorized',
        extraction.amountCents,
        extraction.currency,
        extraction.transactionDate,
        JSON.stringify(detailFields),
      ],
    );
    await client.query('UPDATE documents SET status = $1 WHERE id = $2 AND org_id = $3', [
      'needs_review',
      identity.documentId,
      identity.orgId,
    ]);
    await client.query('COMMIT');
    await logAction(identity.orgId, SYSTEM_ACTOR, 'extraction_saved', 'transactions', transactionId, {
      document_id: identity.documentId,
      source: SYSTEM_ACTOR,
    });
    return 'saved';
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function markNeedsReview(identity: DocumentIdentity, reason: string): Promise<void> {
  if (IS_MOCK) {
    const db = readMockDb();
    if (db.transactions.some((t) => t.document_id === identity.documentId && t.org_id === identity.orgId)) {
      return;
    }
    const doc = db.documents.find((d) => d.id === identity.documentId && d.org_id === identity.orgId);
    if (doc) doc.status = 'needs_review';
    writeMockDb(db);
  } else {
    const existing = await getPool().query('SELECT 1 FROM transactions WHERE document_id = $1 AND org_id = $2', [
      identity.documentId,
      identity.orgId,
    ]);
    if ((existing.rowCount ?? 0) > 0) return;
    await getPool().query('UPDATE documents SET status = $1 WHERE id = $2 AND org_id = $3', [
      'needs_review',
      identity.documentId,
      identity.orgId,
    ]);
  }
  await logAction(identity.orgId, SYSTEM_ACTOR, 'extraction_failed', 'documents', identity.documentId, {
    reason,
    source: SYSTEM_ACTOR,
  });
}
