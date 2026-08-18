# documents — A4: Access-controlled raw document retrieval

Lets an authorized volunteer view the original document image (the raw
upload behind an extracted transaction) via a pre-signed, short-TTL S3 URL
— without exposing it broadly. Enforces RBAC server-side, generates a
5-minute pre-signed `GetObject` URL, and audits every generation.

## Commands

```
npm run document:retrieve -- --document-id <id> --role <role> [--volunteer-id <id>]
```

`--role` is required and enforced server-side via `lib/rbac.ts` (D1) — only
`reviewer` and `treasurer` hold the `view_raw_document` capability; any
other role (including `leadership`) is rejected and the denial is
audit-logged. This stands in for the auth context a real HTTP endpoint
would populate from the caller's session once `services/api` (#26) has one.

**Example:**
```
npm run document:retrieve -- --document-id 11111111-1111-4111-8111-111111111111 --role reviewer
npm run document:retrieve -- --document-id 11111111-1111-4111-8111-111111111111 --role treasurer
npm run document:retrieve -- --document-id 11111111-1111-4111-8111-111111111111 --role leadership   # rejected, audit-logged
```

## Environment variables

| Variable | Required for real mode | Description |
|---|---|---|
| `DATABASE_URL` or `COCKROACH_DATABASE_URL` | Yes | CockroachDB connection string |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | Yes | AWS credentials |
| `AWS_REGION` | No | Defaults to `us-east-1` |
| `INGESTION_BUCKET` | No | Defaults to `fiscus-ingestion-local`; same bucket `services/ingestion/s3-extraction` uploads into |

## Mock vs real mode

If either `DATABASE_URL`/`COCKROACH_DATABASE_URL` or AWS credentials are
absent, the module auto-switches to **mock mode** (same `IS_MOCK` pattern
as every other module in this repo):
- The document row is read from `fixtures/mock-db.json` instead of
  CockroachDB.
- Instead of a real S3 `getSignedUrl()` call, a fake pre-signed-looking URL
  is returned with the expiry timestamp embedded in a query param
  (`mock://local-download/{bucket}/{key}?expires={epochMillis}`) — good
  enough to exercise the TTL math without real AWS credentials.
- The audit row is appended to `fixtures/mock-db.json` instead of
  `audit_log`.

Apply `db/migrations/001_b2_minimal.sql` through `005_d2_summaries.sql` in
order before running in real mode (`002_b1_docs_transactions.sql` is what
creates the `documents` table this module reads).

## RBAC enforcement

`retrieveDocumentUrl()` calls `enforceAccess()` from `lib/rbac.ts` (D1)
before doing anything else — only `reviewer`/`treasurer` (the
`view_raw_document` capability) may generate a retrieval URL. A denied
attempt writes an `access_denied` row to `audit_log` and throws
`AccessDeniedError`, rather than silently no-op'ing or leaking whether the
document exists. `leadership` and `data_entry` are both denied; there is
no owner-scoped carve-out for `data_entry` here (unlike
`upload_documents`/`apply_corrections`) — see `docs/security.md`.

On success, a second audit row (`action = view_raw_document`) is written
recording the document id and the URL's expiry — every raw-document view
produces an audit row, per the A4 acceptance criteria.

## TTL / expiry

The pre-signed URL's TTL is fixed at 300 seconds (5 minutes) —
`TTL_SECONDS` in `src/client.ts` — not caller-configurable, so nothing can
ask for a longer-lived link. In real mode, S3 itself rejects (403s) a
request against an expired pre-signed URL; there is nothing else to
enforce. In mock mode there's no real HTTP round trip to 403, so
`retrieveDocumentUrl()` accepts an injectable clock (`opts.now`) and
`isExpired()` in `src/retrieve.ts` checks a previously-returned result's
`expiresAt` against a given instant — this is how
`test/documents-retrieve.test.ts` proves the TTL math is correct without
waiting 5 real minutes.

## Spec note

This module is standalone for now (like `services/api/summaries` was
before #26 wired it into HTTP) — issue #26 (the real Express server) is
being built in parallel. `retrieveDocumentUrl()` is written to be directly
importable so #26 can wrap it in a route (e.g.
`GET /documents/:id/raw-url`) without changes here.
