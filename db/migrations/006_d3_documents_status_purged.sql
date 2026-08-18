-- 006_d3_documents_status_purged.sql
-- Issue D3: data retention and lifecycle jobs (AGENTS.md §5, rule 6).
--
-- documents.status carries a CHECK constraint from B1's stopgap migration
-- (002_b1_docs_transactions.sql), predating A1, restricting it to
-- ('uploaded','extracting','needs_review','approved','rejected'). The
-- retention purge job (services/lifecycle/retention) needs to mark a row
-- 'purged' once its raw S3 file has been deleted past the org's
-- retention_years window -- the row itself, and everything derived from it
-- in `transactions`, stays; only the CHECK constraint needs widening to
-- allow the new terminal status.
--
-- CockroachDB has no ALTER TABLE ... ALTER CONSTRAINT to add a single enum
-- value to an existing CHECK, so this drops and recreates it with 'purged'
-- added -- same shape as any other CHECK edit against this table. The
-- constraint name (documents_status_check) matches CockroachDB's default
-- naming, confirmed against docs/schema.md's SHOW CREATE TABLE dump.

ALTER TABLE documents DROP CONSTRAINT documents_status_check;

ALTER TABLE documents ADD CONSTRAINT documents_status_check
  CHECK (status IN ('uploaded', 'extracting', 'needs_review', 'approved', 'rejected', 'purged'));
