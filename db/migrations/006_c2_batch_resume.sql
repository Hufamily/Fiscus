-- C2: batch/document-review resume state on `sessions`.
--
-- Issue C2 ("Session/task-state persistence") needs to track which document
-- in a batch a volunteer is currently working through, so killing the agent
-- process mid-batch and restarting resumes at the same point.
--
-- `pending_documents` (added by 003_c1_sessions.sql) looks like the obvious
-- place for this given its name, but C1 already repurposed it to store RAG
-- Q&A conversation history (see services/agent/src/agent.ts's ask()) before
-- this issue was picked up -- CLAUDE.md's Learnings log flagged this as a
-- semantic overload and said future migrations should add a dedicated
-- column rather than further overloading `pending_documents`. Verified by
-- reading services/agent/src/{agent,client,types}.ts: `pending_documents`
-- is written/read exclusively as `{ conversation: [...] }` today, and
-- `current_index` is set on every row but never actually read or advanced
-- anywhere in the codebase -- it's a dead column, not a repurposed one.
--
-- So: leave `pending_documents` alone (still owned by C1's chat flow), and
-- give batch-resume its own two columns. `current_index` (already on the
-- table, previously unused) becomes the real pointer into the new
-- `batch_document_ids` array -- no need for a third column to track
-- position.
--
-- Result: `sessions` now serves two independent concerns through disjoint
-- columns on the same row -- chat history (`pending_documents`) and batch
-- progress (`batch_document_ids` + `current_index` + `batch_status`). See
-- services/agent/src/batch-session.ts for the state machine this drives.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS batch_document_ids JSONB NOT NULL DEFAULT '[]';

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS batch_status TEXT NOT NULL DEFAULT 'idle'
    CHECK (batch_status IN ('idle', 'in_progress', 'completed'));
