# Ingestion service (Track A)

S3 upload handling + Lambda extraction pipeline. See issues A2, A3, A4 in
[`ISSUES.md`](../../ISSUES.md) and the data model in
[`AGENTS.md` §4](../../AGENTS.md).

## Setup

## Run and deploy

1. Run `python -m pip install -r requirements.txt` from this directory.
2. Set `AWS_REGION`, `BEDROCK_MODEL_ID`, and `COCKROACH_DATABASE_URL` from
   the root `.env.example`.
3. Run `npm run db:migrate` from the repository root to create the core
   CockroachDB tables.
4. Build and deploy [`template.yaml`](./template.yaml) with AWS SAM, passing
   `BedrockModelId` and `DatabaseUrl` parameters.
5. Use `create_upload` from `app/upload.py` behind an authenticated API route.
   It records the upload and returns a five-minute presigned URL for a PDF,
   PNG, or JPEG up to 10 MB.

The Lambda handler is `app/handler.py`. It only accepts the documented S3 key
shape, redacts extraction output before persistence, and writes through the
audited service layer. Terminal extraction errors become `needs_review`;
unexpected AWS/database errors are retried and retained by the configured SQS
dead-letter queue.

Run the Python contract tests with `python -m unittest test_pipeline.py` from
this directory.

Read [the Free Tier cost guard](./aws-pipeline/COST-GUARD.md) before deploying.
It makes Bedrock opt-in because model inference is metered.
