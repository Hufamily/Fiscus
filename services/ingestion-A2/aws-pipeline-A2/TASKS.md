# Track A AWS pipeline tasks

Complete these tasks in order. A dependency marked "external" needs the
named track owner to provide its contract before integration.

## 1. Infrastructure

- [ ] Choose one AWS Region that supports the selected Bedrock model and use
      it for S3, Lambda, and related resources.
- [ ] Create the private ingestion S3 bucket; block public access, enable
      versioning and server-side encryption, and configure the organization
      retention lifecycle rule.
- [ ] Add an `s3:ObjectCreated:*` event filter that only targets
      `*/original.*` objects and grants S3 permission to invoke Lambda.
- [ ] Create the extraction Lambda execution role with least-privilege access
      to the bucket prefix, Bedrock inference, Secrets Manager, CloudWatch,
      and the failure queue.
- [ ] Create an SQS standard queue as the Lambda on-failure destination and
      configure CloudWatch alarms for Lambda errors and visible DLQ messages.
- [ ] Put the CockroachDB connection string in Secrets Manager and configure
      the Lambda to obtain it at runtime.

## 2. Upload and event contract

- [ ] Create an authenticated upload flow that generates UUID `document_id`
      values and issues a presigned S3 upload URL only for the caller's
      `{org_id}` prefix.
- [ ] Enforce the object-key contract:
      `{org_id}/{document_id}/original.{ext}`.
- [ ] Validate type and size before issuing an upload URL; document supported
      receipt/form formats.
- [x] Record enough initial document metadata for a failure to be shown even
      if extraction never succeeds. **Dependency: A1.**

## 3. Lambda extraction

- [x] Parse and validate the S3 event key; derive `org_id` and `document_id`
      from the key rather than from untrusted request metadata.
- [x] Fetch the S3 object and invoke a Bedrock vision/OCR-capable model with
      a JSON-only schema for vendor, date, amount, currency, and line items.
- [x] Validate the returned JSON, normalize dates and monetary values, and
      reject incomplete or malformed results with a safe error code.
- [x] Pass every persistable text field through redaction before it reaches
      the database. **Dependency: A3.**
- [x] Never log raw file contents, model prompts containing sensitive text, or
      unredacted Bedrock output.

## 4. Persist, audit, and recover

- [x] Implement a shared service method that atomically writes the
      `documents` status, transaction row(s), and `logAction(...)` audit
      record. Do not write through MCP. **Dependency: A1.**
- [x] Make the write idempotent on `document_id` so repeated S3 deliveries do
      not duplicate transactions or audit events.
- [x] On a terminal extraction failure, set `documents.status = needs_review`
      through the same service layer and create an audit entry.
- [ ] Preserve the failed event in SQS and provide a safe reprocess command or
      documented manual recovery procedure.

## 5. Agentic-memory integration (external)

- [ ] Hand Track B the redacted transaction/document representation needed to
      produce embeddings and add it to CockroachDB Distributed Vector Indexing.
- [ ] Hand Track C the `extracted` and `needs_review` status contract so the
      Bedrock agent can retrieve prior financial memory via Managed MCP and
      surface failures to volunteers.
- [ ] Verify all agent retrievals and vector searches filter by `org_id`.

## 6. Verification and submission evidence

- [ ] Upload a sample receipt and verify a `transactions` row appears within
      a few seconds.
- [ ] Verify no raw file bytes or unredacted card data exist in CockroachDB or
      application logs.
- [ ] Force a Bedrock/extraction failure; verify `needs_review`, an audit row,
      CloudWatch error data, and the SQS failure event are visible.
- [ ] Verify a successful extraction produces exactly one audit row and no
      duplicate transactions when the event is replayed.
- [ ] Capture demo evidence: S3 upload, Lambda/Bedrock result, CockroachDB
      memory and audit record, and agent retrieval using MCP/vector search.
- [ ] Add actual AWS-tool usage to `docs/tool-usage.md` and setup/run steps to
      the ingestion README once the implementation lands.
