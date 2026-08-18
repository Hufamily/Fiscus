# summaries — D2: Executive Financial Summaries

Generates 120-180 word executive summaries for leadership. Queries aggregate-only SQL (no row-level data — RBAC per AGENTS.md §5), redacts, calls Bedrock Claude, stores in the `summaries` table, and audits every generation.

## Commands

```
npm run summary:generate -- --period <label> --role <role> [--volunteer-id <id>]
```

`--role` is required and enforced server-side via `lib/rbac.ts` (D1) —
only `treasurer` and `leadership` hold the `view_aggregate_reports`
capability; any other role is rejected and the denial is audit-logged.
This stands in for the auth context a real HTTP endpoint would populate
from the caller's session once `services/api` has one.

**Example:**
```
npm run summary:generate -- --period YTD --role treasurer
npm run summary:generate -- --period Q3-2024 --role leadership
npm run summary:generate -- --period YTD --role data_entry   # rejected, audit-logged
```

## Environment variables

| Variable | Required for real mode | Description |
|---|---|---|
| `DATABASE_URL` or `COCKROACH_DATABASE_URL` | Yes | CockroachDB connection string |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | Yes | AWS credentials |
| `AWS_REGION` | No | Defaults to `us-east-1` |
| `BEDROCK_MODEL_ID` | No | Defaults to `us.anthropic.claude-3-5-haiku-20241022-v1:0` |

## Mock vs real mode

If either `DATABASE_URL` or `AWS_ACCESS_KEY_ID` is absent, the module auto-switches to **mock mode**:
- Aggregates computed in-memory from `fixtures/mock-db.json` (3 seeded transactions)
- A deterministic 120-180 word mock summary referencing seeded category totals is returned
- Summary and audit rows stored in `fixtures/mock-db.json`

Apply `db/migrations/001_b2_minimal.sql` through `005_d2_summaries.sql` in order before running in real mode (in particular `004_a1_volunteers_corrections_indexes.sql`, since `summaries.org_id` and the RBAC role check both assume `organizations`/`volunteers` already exist).

## RBAC enforcement

Two layers, per the D1 spec:
- **Query shape:** the aggregate query uses `GROUP BY category, status` only — no individual transaction rows, vendor names, or person names cross the query boundary.
- **Access check:** `generateSummary()` calls `enforceAccess()` from `lib/rbac.ts` (D1) before doing anything else — only `treasurer`/`leadership` (the `view_aggregate_reports` capability) may generate a summary. A denied attempt writes an `access_denied` row to `audit_log` and throws, rather than silently no-op'ing.

## Spec note

The `summaries` table is additive — it is not in AGENTS.md §4. Flagged in PR for team awareness; all other tables remain unchanged.
