-- 004_a1_volunteers_corrections_indexes.sql
-- Issue A1: completes the core schema contract (AGENTS.md §4).
--
-- 001/002/003 already created organizations, templates, audit_log, documents,
-- transactions, and sessions as minimal stopgaps so other tracks could start
-- coding early. This migration adds the two tables nobody had gotten to yet
-- (volunteers, corrections) and — the part that actually needs Track A —
-- the real CockroachDB Distributed Vector Index on templates.embedding and
-- transactions.embedding. Until now those columns were only ever queried
-- with the `<->` operator against a plain heap scan; there was no index
-- backing it.
--
-- org_id is the leading/prefix column on both vector indexes so CockroachDB
-- partitions the index per tenant — AGENTS.md §4 requires similarity search
-- to always be filtered by org_id, and a prefix column is how the vector
-- index enforces that at the index level rather than relying on every
-- caller to remember a WHERE clause.
--
-- Requires CockroachDB v25.2+. Requires the connecting user to have
-- MODIFYCLUSTERSETTING (the SET below is a cluster-wide, idempotent flag).

SET CLUSTER SETTING feature.vector_index.enabled = true;

CREATE TYPE volunteer_role AS ENUM ('data_entry', 'reviewer', 'treasurer', 'leadership');

CREATE TABLE IF NOT EXISTS volunteers (
  id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID           NOT NULL REFERENCES organizations(id),
  role         volunteer_role NOT NULL,
  display_name TEXT           NOT NULL
);

-- "Learned memory" table: the agent reads recent corrections for an org
-- before extracting new documents of the same type. doc_type is
-- intentionally NOT a column here — per AGENTS.md §4, join
-- transaction_id -> transactions.document_id -> documents.doc_type instead,
-- so there's exactly one place doc_type lives.
CREATE TABLE IF NOT EXISTS corrections (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID        NOT NULL REFERENCES organizations(id),
  transaction_id  UUID        NOT NULL REFERENCES transactions(id),
  field           TEXT        NOT NULL,
  original_value  TEXT,
  corrected_value TEXT        NOT NULL,
  corrected_by    UUID        NOT NULL REFERENCES volunteers(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE VECTOR INDEX IF NOT EXISTS templates_org_embedding_idx
  ON templates (org_id, embedding);

CREATE VECTOR INDEX IF NOT EXISTS transactions_org_embedding_idx
  ON transactions (org_id, embedding);
