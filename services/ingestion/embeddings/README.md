# embeddings — B1/B3: Document Embedding Pipeline + Semantic Search

Reads local financial documents, extracts structured fields via Bedrock, generates 1536-dim Titan embeddings, and persists transaction rows to CockroachDB. Also provides vector similarity search over both transactions and templates, plus anomaly flagging (B3, issue #8).

## Semantic search API (B3)

`src/search.ts` exports the reusable entry points other services import (e.g. `services/api`, issue #26):

- `searchSimilarTransactions(query: string, k?: number)` — free-text query, returns top-k similar transactions.
- `searchSimilarTemplates(queryEmbedding: number[], k?: number)` — "which template does this look like?"; takes a precomputed embedding (e.g. from a newly-ingested document) and returns the top-k matching templates ranked by similarity.
- `searchTemplatesByText(query: string, k?: number)` — same, but from free text.

`src/anomaly.ts` exports `checkAndFlagAnomaly(transactionId, embedding, opts?)`: looks up the transaction's `k` nearest neighbors (default 3) and, if all of them are below a similarity threshold (default L2 distance 8), sets `status = 'review_flagged'` and audit-logs an `anomaly_flagged` action. Wired into `embed:file` so it runs automatically on ingest; also callable standalone.

## Install

Dependencies are at the monorepo root. From repo root:
```
npm install
```

## Commands

### Embed documents
```
npm run embed:file -- --files <file1> <file2> ... --doc-type <type>
```

**Arguments:**
- `--files`: one or more `.txt` document paths (relative to `services/ingestion/embeddings/`)
- `--doc-type`: form type identifier (e.g. `vet_invoice`, `donation_receipt`, `supply_receipt`)

**Example (bundled fixtures):**
```
npm run embed:file -- --files fixtures/vet_invoice_1.txt fixtures/donation_receipt_1.txt fixtures/supply_receipt_1.txt --doc-type vet_invoice
```

### Search transactions
```
npm run search -- --query "<question or phrase>"
```

**Example:**
```
npm run search -- --query "vet bills in june"
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
- Bedrock extraction returns deterministic fixtures keyed by `--doc-type`
- Embeddings are deterministic 1536-dim sine-based floats
- DB reads/writes go to `fixtures/mock-db.json`
- Search ranks by real L2 distance (`client.ts`'s `l2Distance`) against the stored fixture embeddings — same `vector_l2_ops` semantics CockroachDB's `<->` uses in real mode, just computed in JS instead of pushed down to the index.

**Note on mock-mode embeddings:** `lib/embeddings.ts`'s mock path is a deterministic hash of the input text, not a real semantic embedding — identical text always collapses to distance 0, but otherwise distances land in a fairly narrow band regardless of how semantically related two documents actually are. That's enough to demonstrate ranking/anomaly *mechanics* (see `test/search.test.ts`), but genuine graded similarity only shows up in real mode against Titan.

Apply `db/migrations/002_b1_docs_transactions.sql` and `db/migrations/006_b3_review_flagged.sql` before running in real mode.

## v2 ideas

- S3 input: accept `s3://bucket/key` paths when Track A's Lambda is available
- PDF/image text extraction: currently text files only; A2's Lambda handles binary formats
- Batch parallelism: embed multiple files concurrently (current loop is sequential)
- HTTP endpoint: `POST /embed`, `GET /search?q=...` once API service lands (`services/api`, issue #26) — `searchSimilarTransactions`/`searchSimilarTemplates`/`checkAndFlagAnomaly` are already shaped for that
