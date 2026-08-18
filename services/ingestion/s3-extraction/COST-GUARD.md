# AWS Free Tier cost guard

This project is intentionally small enough for a hackathon demo, but no AWS
architecture can promise a $0 bill after an account's Free Tier allowance or
credits are exhausted. Before deploying, use an AWS **Free Plan** account (or
confirm your available Free Tier credits), create a monthly $1 budget alert,
and delete the stack when the demo is finished.

## Default deployment: free-tier-eligible path

- Use S3 only for a handful of demo files, each capped at 10 MB.
- Use one Lambda with a 30-second timeout, 1 GB memory, and low reserved
  concurrency; do not expose it to the internet.
- Use one SQS failure queue; purge it after testing.
- Use S3-managed encryption (`AES256`), not a customer-managed KMS key.
- Pass the CockroachDB URL as an encrypted Lambda environment variable at
  deployment time. This avoids the standing per-secret fee of Secrets Manager.
- Set log retention to three days and do not create paid dashboards or log
  subscriptions.

## Bedrock is opt-in

Bedrock model inference is metered. Keep `BEDROCK_MODEL_ID` set to `DISABLED`
until you have confirmed the account's credits and model access. The pipeline
will safely mark the document `needs_review` instead of sending a paid model
request. Enable a model only for the few receipts recorded in the demo.

The AWS Free Plan can include credits that may be applied to Bedrock, but this
depends on account type, credit balance, and current AWS terms. Do not treat
those credits as an unlimited or permanent Bedrock free tier.

## Required account controls

1. In Billing, activate Free Tier and billing email alerts.
2. Create one monthly AWS Budget with a $1 threshold and an email alert.
3. Check the Free Tier/Credits dashboard before and after the demo.
4. Delete the SAM stack (including its S3 objects) after judging, unless you
   deliberately want to retain it.

Sources: [AWS Free Tier FAQ](https://aws.amazon.com/free/free-tier-faqs/),
[AWS Budgets pricing](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/),
and [Amazon Bedrock service tiers](https://aws.amazon.com/bedrock/service-tiers/).
