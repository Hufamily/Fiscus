-- C1: sessions table per AGENTS.md §4.
-- Owned jointly by Tracks A and C; additive migration, safe to run after 001.

CREATE TABLE IF NOT EXISTS sessions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID        NOT NULL REFERENCES organizations(id),
  volunteer_id      TEXT        NOT NULL,
  pending_documents JSONB       NOT NULL DEFAULT '{}',
  current_index     INT         NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_org_volunteer_idx
  ON sessions (org_id, volunteer_id);
