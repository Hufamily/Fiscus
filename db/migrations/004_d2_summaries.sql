-- D2: summaries table. Additive migration; not in AGENTS.md §4 — flagged in PR.
-- Stores Claude-generated executive summaries over aggregate-only financial data.

CREATE TABLE IF NOT EXISTS summaries (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL REFERENCES organizations(id),
  period_label TEXT        NOT NULL,
  body         TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS summaries_org_period_idx
  ON summaries (org_id, period_label, created_at DESC);
