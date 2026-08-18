// C2: batch/document-review resume logic ("Session/task-state persistence").
//
// Distinct from agent.ts's ask() Q&A flow: this tracks a volunteer's
// progress working through a queue of documents (e.g. everything sitting in
// documents.status = 'needs_review'), so that killing the agent process
// mid-batch and restarting resumes at the same document instead of starting
// over. State lives entirely in CockroachDB (the `sessions` table, via
// client.ts's getOpenBatchSession/createBatchSession/advanceBatchSession) --
// never in memory -- which is what makes it survive a process restart.
//
// This intentionally does NOT touch `pending_documents` (see client.ts's
// getSession/upsertSession) -- that column already stores C1's Q&A
// conversation history and is a separate concern living on the same table.
// See 006_c2_batch_resume.sql for why a new column was added instead of
// overloading pending_documents further.

import { logAction } from '../../../lib/audit';
import {
  ORG_ID,
  VOLUNTEER_ID,
  getOpenBatchSession,
  createBatchSession,
  advanceBatchSession,
} from './client';
import type { SessionRow } from './types';

export interface ResumedBatch {
  session: SessionRow;
  /** The document the volunteer was working on when the process died. */
  nextDocumentId: string;
}

/**
 * Check for an open (in_progress) batch session for this org/volunteer.
 * Call this on agent start / volunteer login before starting a fresh batch
 * -- this is the "resume rather than starting fresh" requirement from C2.
 * Returns null if there's nothing to resume.
 */
export async function resumeOpenBatch(
  orgId: string = ORG_ID,
  volunteerId: string = VOLUNTEER_ID,
): Promise<ResumedBatch | null> {
  const session = await getOpenBatchSession(orgId, volunteerId);
  if (!session) return null;
  const nextDocumentId = session.batch_document_ids[session.current_index];
  return { session, nextDocumentId };
}

/**
 * Start a brand-new batch. Callers should call resumeOpenBatch() first --
 * starting a second concurrent batch for the same org/volunteer while one is
 * already in_progress is allowed by the schema (there's no uniqueness
 * constraint) but almost certainly not what a caller wants, so resuming is a
 * deliberate, separate step rather than something this function does
 * automatically.
 */
export async function startBatch(
  documentIds: string[],
  orgId: string = ORG_ID,
  volunteerId: string = VOLUNTEER_ID,
): Promise<SessionRow> {
  const session = await createBatchSession(orgId, volunteerId, documentIds);
  await logAction(orgId, volunteerId, 'batch_started', 'sessions', session.id, {
    documentCount: documentIds.length,
  });
  return session;
}

/**
 * Mark the current document done and advance the pointer. Returns the
 * updated session; batch_status flips to 'completed' once current_index
 * walks past the end of batch_document_ids.
 */
export async function advanceBatch(sessionId: string): Promise<SessionRow> {
  const session = await advanceBatchSession(sessionId);
  await logAction(
    session.org_id,
    session.volunteer_id,
    session.batch_status === 'completed' ? 'batch_completed' : 'batch_advanced',
    'sessions',
    session.id,
    { current_index: session.current_index },
  );
  return session;
}

/** The document the volunteer should work on next, or null if the batch is done. */
export function currentBatchDocument(session: SessionRow): string | null {
  if (session.batch_status !== 'in_progress') return null;
  return session.batch_document_ids[session.current_index] ?? null;
}
