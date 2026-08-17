# Project tracks and issues

## Track A — Ingestion & core data model

### AWS ingestion infrastructure

**Description:** When a volunteer uploads a receipt or form, store the raw
file in S3, trigger extraction, and write the structured fields to
CockroachDB.

#### AWS provisioning

Define and deploy the following resources as infrastructure as code (Python
AWS CDK is preferred). Do not configure these resources at application
runtime.

- Create one private S3 bucket with versioning and server-side encryption
  enabled. Store objects at
  `s3://{bucket}/{org_id}/{document_id}/original.{ext}`.
- Create the extraction Lambda and its execution role. The role must have
  least-privilege access to read the receipt objects, invoke the selected
  Bedrock vision/OCR-capable model, write CloudWatch logs, and read the
  CockroachDB connection secret.
- Configure an S3 `ObjectCreated` notification for the receipt-object prefix
  to invoke the extraction Lambda. Provision the corresponding Lambda
  resource permission allowing only this bucket to invoke it.
- Store `COCKROACH_DATABASE_URL` in AWS Secrets Manager and grant only the
  extraction Lambda permission to retrieve it. Do not put credentials in
  source code, prompts, or Lambda environment variables.
- Configure the Lambda with non-secret settings such as `AWS_REGION`, the
  bucket name, and the Bedrock model ID. Ensure the selected Bedrock model is
  available in the deployment region and that the Lambda role has
  `bedrock:InvokeModel` permission.
- Enable CloudWatch logging and create an alarm or failure destination so
  repeated extraction failures are observable.

#### Extraction workflow

1. A volunteer uploads a receipt or form to the prescribed S3 key.
2. The S3 event invokes Lambda.
3. Lambda retrieves the raw object and calls Bedrock to extract line items,
   amounts, dates, and vendor.
4. Lambda writes a `documents` row with `status = extracted` and a
   `transactions` row through the shared service layer—not raw MCP writes—so
   redaction and audit logging happen automatically.
5. On extraction failure, Lambda records `documents.status = needs_review`.
   Track C then surfaces the item to the volunteer instead of silently
   dropping it.

#### Acceptance criteria

- Uploading a sample receipt to S3 produces a `transactions` row within a
  few seconds.
- Extraction failures are visible in the document status and operational logs;
  they are not swallowed.
- No raw file bytes are stored anywhere in CockroachDB.
- The extraction write creates an audit-log entry.
- The deployment is reproducible from the infrastructure code and leaves no
  manually required S3-to-Lambda or IAM connection.
