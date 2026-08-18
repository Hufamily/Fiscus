# template-gen — B2: Template Generation from Example Documents

Part of the Fiscus agentic bookkeeping system. Given 2+ example documents of a new form type, infers a reusable field extraction template (schema_json) and stores it in CockroachDB as `pending_review`.

## Install

All dependencies are installed at the monorepo root. From the repo root:

```
npm install
```

## Commands

Both commands are run from the **repo root** via npm scripts.

### Generate a template

```
npm run template:generate -- --form-type <name> --files <file1> <file2> [file3 ...]
```

- `--form-type`: a snake_case identifier for the form type (e.g. `vet_invoice`, `donation_receipt`)
- `--files`: 2+ example document paths (`.txt` / `.md`). Relative paths resolve from this module's root (`services/ingestion/template-gen/`), not the repo root.

**Example (uses bundled fixtures):**

```
npm run template:generate -- --form-type vet_invoice --files fixtures/vet_invoice_1.txt fixtures/vet_invoice_2.txt
```

### Approve a template

```
npm run template:approve -- --id <template_id>
```

Flips the template's status from `pending_review` to `approved`. A second call on an already-approved template is a no-op with a clear message.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` or `COCKROACH_DATABASE_URL` | For real mode | CockroachDB / Postgres connection string |
| `AWS_ACCESS_KEY_ID` | For real mode | AWS credential |
| `AWS_SECRET_ACCESS_KEY` | For real mode | AWS credential |
| `AWS_REGION` | Optional | Defaults to `us-east-1` |
| `BEDROCK_MODEL_ID` | Optional | Defaults to `us.anthropic.claude-haiku-4-5-20251001-v1:0` |

## Mock vs real mode

If `DATABASE_URL` / `COCKROACH_DATABASE_URL` **or** `AWS_ACCESS_KEY_ID` are absent, the module runs in **mock mode** automatically. No credentials needed to develop or test.

- Bedrock calls return deterministic fixture schema_json (5 fields for `vet_invoice` form type).
- DB reads/writes go to `fixtures/mock-db.json` in this directory.
- Embeddings are deterministic sine-based 1536-dim float arrays.
- The redacted prompt is printed to stderr so you can verify PII was stripped.

**Special form types for testing:**
- `__bad_first__` — mock Bedrock returns invalid JSON on the first call, valid JSON on retry (tests the Zod retry path)
- `__always_bad__` — mock Bedrock always returns invalid JSON (tests the clean error path)

In **real mode** (all env vars set), the same code path runs against live CockroachDB and Bedrock. Apply `db/migrations/001_b2_minimal.sql` to your database first.

## Database migration

```sql
-- Apply once per environment:
psql $DATABASE_URL -f db/migrations/001_b2_minimal.sql
```

The migration creates `organizations`, `templates`, and `audit_log` tables plus a seed org (`id = 00000000-0000-0000-0000-000000000001`).

## Security

All document text is passed through `lib/redact.ts` (Luhn-validated credit card masking) before anything is sent to Bedrock. Card numbers never appear in prompts, embeddings, or the database.

## v2 ideas (out of scope for v1)

- **HTTP endpoints**: `GET /templates`, `POST /templates/:id/approve` — shapes already match `services/web/src/api/client.ts`, waiting for the API service to land.
- **S3 input**: fetch documents from S3 when Track A's Lambda (A2) is available.
- **PDF / image support**: binary extraction is A2's job; accept pre-extracted text from A2 here.
- **Real actor ID**: pass a volunteer ID from a session instead of the `cli-system` constant.
- **Template versioning**: new major version on schema change, keeping old version for in-flight documents.
- **Broader PII redaction**: SSNs, bank routing numbers, full-name + DOB combos (extend `lib/redact.ts`).
