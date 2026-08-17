-- 002_b1_docs_transactions.sql
-- Adds documents + transactions tables per AGENTS.md §4.
-- B1 adds documents as the FK parent for transactions.
-- Track A owns the full write path; B1 adds the minimal DDL to unblock embeddings.

CREATE TABLE IF NOT EXISTS documents (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations(id),
  s3_key      TEXT        NOT NULL,
  doc_type    TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'approved',
  uploaded_by TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT documents_status_check CHECK (status IN ('uploaded', 'extracting', 'needs_review', 'approved', 'rejected'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID        NOT NULL REFERENCES organizations(id),
  document_id          UUID        NOT NULL REFERENCES documents(id),
  category             TEXT        NOT NULL,
  amount_cents         BIGINT      NOT NULL DEFAULT 0,
  currency             TEXT        NOT NULL DEFAULT 'USD',
  txn_date             DATE,
  extracted_fields_json JSONB,
  embedding            VECTOR(1536),
  status               TEXT        NOT NULL DEFAULT 'pending_review',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT transactions_status_check CHECK (status IN ('pending_review', 'approved', 'rejected'))
);

-- B3 will add USING ivfflat / hnsw vector index for production similarity search.
-- For now a plain index on created_at suffices for sequential scans in dev.
CREATE INDEX IF NOT EXISTS transactions_created_at_idx ON transactions (org_id, created_at DESC);
