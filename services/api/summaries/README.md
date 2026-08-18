# summaries — D2: Executive Financial Summaries

Generates 120-180 word executive summaries for leadership. Queries aggregate-only SQL (no row-level data — RBAC per AGENTS.md §5), redacts, calls Bedrock Claude, stores in the `summaries` table, and audits every generation.

## Commands

```
npm run summary:generate -- --period <label>
```

**Example:**
```
npm run summary:generate -- --period YTD
npm run summary:generate -- --period Q3-2024
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

Apply `db/migrations/001_b2_minimal.sql`, `002_b1_docs_transactions.sql`, `004_d2_summaries.sql` before running in real mode.

## RBAC enforcement

The aggregate query uses `GROUP BY category, status` only — no individual transaction rows, vendor names, or person names cross the query boundary. This is enforced in code; DB-level RBAC is D1's responsibility.

## Spec note

The `summaries` table is additive — it is not in AGENTS.md §4. Flagged in PR for team awareness; all other tables remain unchanged.
