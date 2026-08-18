# agent — C1: Volunteer Q&A Agent

RAG-lite volunteer assistant: retrieves transaction aggregates and vector-similar transactions, then answers questions via Bedrock Claude with citations. Sessions persist conversation history in CockroachDB.

See [`AGENTS.md`](../../AGENTS.md) for the full contract and [`ISSUES.md`](../../ISSUES.md) for C1–C4 issue details.

## Install

Dependencies are at the monorepo root:
```
npm install
```

## Commands

### Ask a question
```
npm run agent:ask -- --question "<question>"
```

### Resume a prior session
```
npm run agent:ask -- --question "<follow-up>" --session <session_id>
```

**Output** (JSON):
```json
{
  "answer": "...",
  "citations": [{"category": "...", "detail": "..."}],
  "session_id": "uuid"
}
```

## Examples (bundled fixtures)

```
npm run agent:ask -- --question "what's pending review?"
npm run agent:ask -- --question "total spend this year"
npm run agent:ask -- --question "how much on vet bills?"
npm run agent:ask -- --question "what's the CEO's salary?"
```

## Environment variables

| Variable | Required for real mode | Description |
|---|---|---|
| `DATABASE_URL` or `COCKROACH_DATABASE_URL` | Yes | CockroachDB connection string |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | Yes | AWS credentials |
| `AWS_REGION` | No | Defaults to `us-east-1` |
| `BEDROCK_MODEL_ID` | No | Defaults to `us.anthropic.claude-haiku-4-5-20251001-v1:0` |

## Mock vs real mode

If either `DATABASE_URL` or `AWS_ACCESS_KEY_ID` is absent, the module auto-switches to **mock mode**:
- Aggregates computed in-memory from `fixtures/mock-db.json` (3 seeded transactions)
- Claude answers are deterministic keyword-matched responses from seeded data
- Sessions and audit rows stored in `fixtures/mock-db.json`

Apply `db/migrations/001_b2_minimal.sql`, `002_b1_docs_transactions.sql`, `003_c1_sessions.sql` before running in real mode.

## Seeded fixture data (mock mode)

| Category | Amount | Date | Status |
|---|---|---|---|
| veterinary | $244.69 | 2024-07-15 | approved |
| veterinary | $324.08 | 2024-08-22 | pending_review |
| office_supplies | $87.50 | 2024-06-10 | approved |

## Spec note

`sessions.pending_documents JSONB` is repurposed to store `{conversation: [{question, answer}]}`. The column name is misleading (designed for Track A document queues); a dedicated Q&A context column would be cleaner. Flagged for Track A/C to decide in a future migration.
