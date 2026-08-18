-- 006_b3_review_flagged.sql
-- B3: semantic search + anomaly flagging (see AGENTS.md §4, docs/schema.md).
-- Adds 'review_flagged' to transactions.status: a transaction whose nearest
-- embedding neighbors are all below a similarity threshold gets flagged here
-- instead of silently sitting in 'pending_review' with everything else.
--
-- CockroachDB doesn't support ALTER-ing a CHECK constraint's expression in
-- place, so this drops and recreates transactions_status_check (same pattern
-- as adding an enum value would need, and this predates a real ENUM here —
-- see AGENTS.md §4 on transactions.status being an open-vocab CHECK, not a
-- typed ENUM like volunteer_role).

ALTER TABLE transactions DROP CONSTRAINT transactions_status_check;

ALTER TABLE transactions ADD CONSTRAINT transactions_status_check
  CHECK (status IN ('pending_review', 'approved', 'rejected', 'review_flagged'));
