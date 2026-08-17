# embeddings — B1: Document Embedding Pipeline

Reads local financial documents, extracts structured fields via Bedrock, generates 1536-dim Titan embeddings, and persists transaction rows to CockroachDB. Also provides vector similarity search (the foundation for B3's semantic search).

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
- Search returns stored transactions in insertion order (rank 1 = first inserted)

**Note on mock search ranking:** In mock mode, rank is insertion order, not semantic similarity. In real mode the `<->` CockroachDB cosine distance operator is used, providing true semantic ranking. B3 will add an `ivfflat` ANN index for production performance.

Apply `db/migrations/002_b1_docs_transactions.sql` before running in real mode.

## v2 ideas

- S3 input: accept `s3://bucket/key` paths when Track A's Lambda is available
- PDF/image text extraction: currently text files only; A2's Lambda handles binary formats
- Batch parallelism: embed multiple files concurrently (current loop is sequential)
- ANN vector index: B3 adds `USING ivfflat` / `USING hnsw` for sub-second search at scale
- HTTP endpoint: `POST /embed`, `GET /search?q=...` once API service lands
