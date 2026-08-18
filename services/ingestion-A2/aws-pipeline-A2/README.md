# AWS receipt-extraction pipeline

This folder is the implementation plan for Track A's receipt/form ingestion
pipeline. It is designed to make the AWS and CockroachDB components
meaningful parts of the agentic-memory product, as required by the hackathon.

## End-to-end flow

```text
Volunteer uploads a receipt/form
  -> presigned S3 upload
  -> s3://{bucket}/{org_id}/{document_id}/original.{ext}
  -> S3 ObjectCreated event
  -> extraction Lambda
  -> Bedrock vision/OCR extraction
  -> redact extracted text
  -> shared write service
  -> CockroachDB documents + transactions + audit_log
  -> Track B embeddings/vector index and Track C agent retrieval
```

The raw file stays in S3. CockroachDB stores only the S3 key, redacted
structured fields, embeddings, agent state, and audit history.

## AWS components

| Service | Purpose | Required configuration |
|---|---|---|
| Amazon S3 | Private raw-document storage | Versioning and server-side encryption enabled; object key is `{org_id}/{document_id}/original.{ext}`; lifecycle retention follows the organization's setting. |
| AWS Lambda | Serverless extraction worker | Triggered by `s3:ObjectCreated:*`; reads the uploaded object, invokes Bedrock, redacts output, and calls the shared database write service. |
| Amazon Bedrock | Vision/OCR extraction | Returns schema-constrained vendor, date, amount, currency, and line-item data. Use the approved model in the selected AWS Region. |
| AWS IAM | Least-privilege access | Lambda can read only the ingestion bucket, invoke the chosen Bedrock model, read runtime secrets, write logs, and publish to the failure queue. |
| AWS Secrets Manager | Runtime secrets | Holds `COCKROACH_DATABASE_URL` and configuration; no credentials belong in code or prompts. |
| Amazon SQS | Failure retention | Lambda on-failure destination/DLQ retains exhausted extraction events for diagnosis and safe reprocessing. |
| Amazon CloudWatch | Observability | Logs, error alarms, duration alarms, and a DLQ-depth alarm. |

## Hackathon evidence

This pipeline contributes the following required-tool evidence:

- **AWS:** S3 materially stores uploaded documents, Lambda runs the
  extraction workflow, and Bedrock provides model inference.
- **CockroachDB persistent memory:** extracted transactions and document
  metadata become durable, tenant-scoped memory; agent state, corrections,
  embeddings, and the audit trail remain in CockroachDB.
- **Managed MCP Server:** Track C retrieves the stored memory in read-only
  mode. It must not write through MCP.
- **Distributed Vector Indexing:** Track B indexes transaction/document
  embeddings for semantic retrieval. The agent should demonstrate retrieval
  of a prior receipt or transaction in the demo.

The submission demo should show: upload, successful extraction, the
CockroachDB memory record and audit entry, an agent query that retrieves that
memory, and a visible `needs_review` failure state.

## Non-negotiable behavior

- Redact before persisting; card numbers may retain only the last four digits.
- Never store raw document bytes or unredacted extraction text in CockroachDB.
- All writes use the shared service layer and `logAction(...)`; never raw MCP
  writes or direct `audit_log` inserts.
- Scope all data access and vector queries by `org_id`.
- Treat S3/Lambda delivery as at-least-once: `document_id` must make writes
  idempotent.
- A failed extraction updates `documents.status` to `needs_review`; Track C
  surfaces it to the volunteer.

See [TASKS.md](./TASKS.md) for the ordered implementation checklist.
