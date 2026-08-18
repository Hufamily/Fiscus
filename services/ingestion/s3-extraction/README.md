# s3-extraction — A2: S3 upload + Lambda extraction pipeline

Private S3 upload → S3-triggered Lambda → Bedrock extraction → redact →
write through the audited service layer. TypeScript rewrite of the
Python/SAM prototype on `origin/track/a/a2-ingestion-rebase-fix` (unmerged,
no PR) — same design, but calls `lib/redact.ts` and `lib/audit.ts` directly
instead of duplicating that logic in a second language. See `CLAUDE.md`
learnings for why the rewrite happened.

## Layout

- `src/key.ts` — parses/builds the `{org_id}/{document_id}/original.{ext}` S3 key shape.
- `src/extract.ts` — Bedrock Converse call, schema validation, and redaction (via `lib/redact.ts`).
- `src/repository.ts` — `documents`/`transactions` writes, all audit logging via `lib/audit.ts` (no direct `audit_log` inserts).
- `src/upload.ts` — registers a document row and returns a 5-minute presigned S3 PUT URL. Not wired into `template.yaml` as its own endpoint yet — see the note in that file.
- `src/handler.ts` — the deployed Lambda entry point (S3 `ObjectCreated` trigger).
- `src/cli.ts` — local testing without AWS: runs the same recordUpload → extract → redact → saveExtraction path against a local file.

## Local testing (mock mode)

```
npm run extract:file -- --file ./some-receipt.pdf --org-id <uuid>
npm run upload:create -- --org-id <uuid> --volunteer-id <uuid> --content-type application/pdf --size-bytes 200000
```

If `DATABASE_URL`/`COCKROACH_DATABASE_URL` is unset, both commands run in
**mock mode**: documents/transactions/audit rows go to
`fixtures/mock-db.json` instead of CockroachDB, and setting
`BEDROCK_MODEL_ID=DISABLED` (the default — see cost guard below) skips the
real Bedrock call and marks the document `needs_review`, matching what the
deployed Lambda does under the same cost guard.

## Real mode / deploy

1. Set `AWS_REGION`, `BEDROCK_MODEL_ID`, and `COCKROACH_DATABASE_URL` (see the root `.env.example`).
2. Run `npm run db:migrate` from the repository root — this module writes to `documents`/`transactions`, both from A1's schema.
3. `sam build && sam deploy`, passing `BedrockModelId` and `DatabaseUrl` parameters (see [`template.yaml`](./template.yaml); D4 owns the actual deploy).
4. Call `createUpload()` (`src/upload.ts`) from an authenticated API route once one exists — it records the upload and returns the presigned URL. Gate it with D1's `upload_documents` capability (`lib/rbac.ts`).

The Lambda handler only accepts the documented S3 key shape, redacts
extraction output before persistence, and writes through the audited
service layer (`lib/audit.ts`). Terminal extraction errors (bad schema,
unsupported file type, cost-guard disabled) become `needs_review` and are
audit-logged with a reason; unexpected AWS/database errors propagate so
SQS's dead-letter queue retries/retains them, same as the Python original.

Read [the Free Tier cost guard](./COST-GUARD.md) before deploying — it
makes Bedrock opt-in because model inference is metered.

## Tests

`test/s3-extraction.test.ts` (repo root) covers the same three contracts
the original `test_pipeline.py` did: tenant-scoped key parsing, schema
validation, and redaction happening before persistence.
