# agent — C1: Volunteer Q&A Agent, C2: Session/task-state persistence

RAG-lite volunteer assistant: retrieves transaction aggregates and vector-similar transactions, then answers questions via Bedrock Claude with citations. Sessions persist conversation history in CockroachDB.

Also implements C2: resumable batch/document-review sessions, so killing the agent process mid-batch and restarting resumes at the same document (state lives in CockroachDB, never in memory — see `src/batch-session.ts`).

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

### Batch/task resume (C2)

```
# Start a batch: registers an ordered queue of document IDs for a volunteer.
npm run agent:batch-start -- --documents doc-1 doc-2 doc-3 --org-id <org_id> --volunteer-id <volunteer_id>

# On agent start / volunteer login: check for an open batch instead of starting fresh.
npm run agent:batch-resume -- --org-id <org_id> --volunteer-id <volunteer_id>

# After finishing the current document, advance the pointer.
npm run agent:batch-advance -- --session <session_id>
```

`batch-resume` is the "resume rather than starting fresh" entry point: it reports the session id and which document to work on next, or says there's nothing open. Because state is written to CockroachDB (or `fixtures/mock-db.json` in mock mode) on every `batch-start`/`batch-advance` call and re-read fresh on every `batch-resume` call, this survives a killed and restarted process — nothing is cached in memory across invocations. See `test/batch-resume.test.ts` at the repo root for a test that proves this by forcing a fresh module instance mid-test (`vi.resetModules()`) between "start+advance" and "resume".

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
| `BEDROCK_MODEL_ID` | No | Defaults to `us.anthropic.claude-3-5-haiku-20241022-v1:0` |

## Mock vs real mode

If either `DATABASE_URL` or `AWS_ACCESS_KEY_ID` is absent, the module auto-switches to **mock mode**:
- Aggregates computed in-memory from `fixtures/mock-db.json` (3 seeded transactions)
- Claude answers are deterministic keyword-matched responses from seeded data
- Sessions and audit rows stored in `fixtures/mock-db.json`

Apply `db/migrations/001_b2_minimal.sql`, `002_b1_docs_transactions.sql`, `003_c1_sessions.sql`, `006_c2_batch_resume.sql` before running in real mode.

## Seeded fixture data (mock mode)

| Category | Amount | Date | Status |
|---|---|---|---|
| veterinary | $244.69 | 2024-07-15 | approved |
| veterinary | $324.08 | 2024-08-22 | pending_review |
| office_supplies | $87.50 | 2024-06-10 | approved |

## Spec note

`sessions.pending_documents JSONB` is repurposed to store `{conversation: [{question, answer}]}`. The column name is misleading (designed for Track A document queues); a dedicated Q&A context column would be cleaner. Flagged for Track A/C to decide in a future migration.

C2 verified this repurposing is total (no code path reads `pending_documents` as an actual document queue) and added dedicated `batch_document_ids` / `batch_status` columns for batch-resume state, rather than further overloading `pending_documents`. `current_index` — present on the table since `003_c1_sessions.sql` but never actually used until now — is the pointer into `batch_document_ids`. See `db/migrations/006_c2_batch_resume.sql` and `docs/schema.md`'s `sessions` section for the full state-machine writeup.
