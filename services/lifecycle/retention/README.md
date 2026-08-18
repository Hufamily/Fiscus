# retention — D3: data retention and lifecycle jobs

Scheduled job that enforces `organizations.retention_years` (AGENTS.md §5,
rule 6): for every org, find `documents` rows past the org's retention
cutoff that still have a raw S3 file present, delete the S3 object, mark
the row `status = 'purged'`, and audit-log the purge. Structured/aggregate
data (`transactions`) is never touched — see "Why D2 is unaffected" below.

## Layout

- `src/types.ts` — `OrganizationRow`, `DocumentRow`, `PurgeResult`.
- `src/client.ts` — `IS_MOCK` detection (mirrors `services/api/summaries`:
  real mode needs *both* `DATABASE_URL`/`COCKROACH_DATABASE_URL` and AWS
  credentials, since this module talks to both CockroachDB and S3), mock-db
  read/write, real `pg` pool, real `S3Client` delete.
- `src/purge.ts` — `computeCutoff()` and `purgeExpiredDocuments()`, the core
  job logic, DB/S3-agnostic (calls through `client.ts`).
- `src/handler.ts` — Lambda entry point for the EventBridge scheduled
  trigger (see `template.yaml`).
- `src/cli.ts` — local testing without a deployed Lambda: runs the same
  `purgeExpiredDocuments()` path the scheduled handler does.

## Local testing (mock mode)

```
npm run retention:purge
```

If `DATABASE_URL`/`COCKROACH_DATABASE_URL` is unset, or no AWS credentials
are configured (`AWS_ACCESS_KEY_ID` / `AWS_PROFILE`), this runs in **mock
mode**: organizations/documents/audit rows come from and go to
`fixtures/mock-db.json`, and S3 deletion is simulated by removing the key
from that file's `s3_objects` array (a stand-in for real bucket contents)
instead of calling `DeleteObjectCommand`.

The bundled fixture has two orgs to exercise both branches of the
acceptance criteria:

- `11111111-…` — `retention_years: 1`, with a document `created_at
  2020-01-01` — past cutoff, gets purged.
- `22222222-…` — `retention_years: 7`, with a document `created_at
  2026-08-01` — within cutoff, untouched.

Run it, then check `fixtures/mock-db.json`: the first org's document flips
to `status: "purged"` and its key disappears from `s3_objects`; the second
org's document and `s3_objects` entry are unchanged; a `document_purged`
row lands in `audit_log`.

## Real mode / deploy

1. Set `AWS_REGION`, `COCKROACH_DATABASE_URL`, and AWS credentials (see the
   root `.env.example`), plus `INGESTION_BUCKET` (the bucket
   `services/ingestion/s3-extraction`'s `IngestionBucket` resolves to).
2. Run `npm run db:migrate` from the repository root — this module needs
   `006_d3_documents_status_purged.sql` applied (adds `'purged'` to
   `documents.status`'s CHECK constraint).
3. `sam build && sam deploy`, passing the `DatabaseUrl` and
   `IngestionBucketName` parameters (see [`template.yaml`](./template.yaml);
   D4 owns the actual deploy). Deployment itself is out of scope for this
   issue — this only defines the stack.

The scheduled Lambda (`EventBridge` rule, default `rate(1 day)`) runs
`purgeExpiredDocuments()` with no event payload, deletes each past-cutoff
document's S3 object, marks it `purged`, and audit-logs the purge through
`lib/audit.ts` (never a direct `audit_log` insert, per AGENTS.md §6).

## Why D2 (aggregate reporting) is unaffected by a purge

`services/api/summaries/src/client.ts`'s `getAggregates()` — the only query
D2's summary generation runs — reads exclusively from `transactions`
(`category`, `status`, `amount_cents`, grouped), and never joins back to
`documents` or reads `documents.s3_key`. This module's purge path touches
only `documents.status` (and the S3 object itself); it never writes to or
deletes from `transactions`. `test/retention-purge.test.ts` asserts this
directly: a transaction's aggregate-relevant fields (`category`, `status`,
`amount_cents`) are byte-identical before and after its parent document is
purged.

## Tests

`test/retention-purge.test.ts` (repo root) covers: a document past its
org's retention window gets purged (S3 delete called, status flipped to
`'purged'`, `document_purged` audit-logged); a document within the window
is left alone (no delete, no audit call for it); and a purge does not
mutate the `transactions` row derived from the purged document.
