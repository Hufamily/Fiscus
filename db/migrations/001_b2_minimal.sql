-- 001_b2_minimal.sql
-- Minimal schema for B2 template generation (AGENTS.md §4 contract).
-- Owns: organizations, templates, audit_log only — no extra columns.
-- Tracks A/C will add documents, transactions, corrections, sessions via later migrations.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS organizations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT        NOT NULL,
  retention_years INT         NOT NULL DEFAULT 7,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS templates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations(id),
  form_type   TEXT        NOT NULL,
  schema_json JSONB       NOT NULL,
  embedding   VECTOR(1536),
  status      TEXT        NOT NULL DEFAULT 'pending_review',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT templates_status_check CHECK (status IN ('pending_review', 'approved'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL REFERENCES organizations(id),
  actor_id     TEXT        NOT NULL,
  action       TEXT        NOT NULL,
  target_table TEXT        NOT NULL,
  target_id    TEXT        NOT NULL,
  detail_json  JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed org for dev/demo; idempotent.
INSERT INTO organizations (id, name, retention_years)
VALUES ('00000000-0000-0000-0000-000000000001', 'Demo Nonprofit', 7)
ON CONFLICT (id) DO NOTHING;
