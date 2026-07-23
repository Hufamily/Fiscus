# AGENTS.md — Project charter and integration contract

This file is the single source of truth for anyone (human or Codex) working
on this repo. Read it before opening a PR. If a decision here conflicts with
an issue description, this file wins — update this file first, then the
issue.

## 1. What we're building

An agentic storage layer that helps volunteers at small nonprofits process
financial documents (receipts, invoices, legacy forms) without needing
accounting expertise, while giving leadership safe, aggregate visibility into
finances. CockroachDB is the persistent memory layer for the agent: template
knowledge, transaction records, embeddings, session state, and the audit
trail all live there.

Built for: CockroachDB × AWS Hackathon — "Build with Agentic Memory."
Deadline: Aug 18, 2026.

## 2. Required tools (do not drop below these)

- **CockroachDB tools (need ≥2, we are using 3):**
  Distributed Vector Indexing, Managed MCP Server, Agent Skills Repo.
- **AWS services (need ≥1, we are using 3):** S3, Lambda, Bedrock.

Every PR touching agent behavior should note in its description which of
these tools it exercises. This isn't bureaucracy — it's literally in the
judging rubric.

## 3. Architecture

```
Volunteer ──► Agent (Bedrock) ──┐
                                 ├──► CockroachDB memory layer
Raw doc ──► S3 ──► Lambda ──────┘      ├─ vector index (embeddings)
  (extraction via Bedrock)             ├─ structured tables (templates, txns)
                                        └─ audit log
                    Agent ◄──► MCP Server ◄──► CockroachDB
```

## 4. Data model conventions (owned by Track A — do not fork this schema)

All tables live in one CockroachDB database, `orgfinance`. Every
tenant-scoped table carries `org_id UUID NOT NULL` for multi-tenant isolation,
even in the demo. `organizations` is the tenant root and is the sole
exception.

Core tables (exact DDL lives in issue `A1`; this is the contract other
tracks code against):

- `organizations(id, name, retention_years INT NOT NULL DEFAULT 7, created_at)`
- `volunteers(id, org_id, role, display_name)` — `role` is an enum:
  `data_entry`, `reviewer`, `treasurer`, `leadership`
- `documents(id, org_id, s3_key, doc_type, status, uploaded_by, created_at)`
  — never store raw file bytes here, only the S3 pointer
- `templates(id, org_id, form_type, schema_json, embedding VECTOR(1536),
  status)` — `status` is `pending_review` until a reviewer approves it
- `transactions(id, org_id, document_id, category, amount_cents, currency,
  txn_date, extracted_fields_json, embedding VECTOR(1536), status)`
- `corrections(id, org_id, transaction_id, field, original_value,
  corrected_value, corrected_by, created_at)` — this is the "learned memory"
  table; the agent reads recent corrections for an org before extracting
  new documents of the same type
- `audit_log(id, org_id, actor_id, action, target_table, target_id,
  detail_json, created_at)` — append-only, every write from every track goes
  through the audit helper (see §6), no exceptions
- `sessions(id, org_id, volunteer_id, pending_documents JSONB, current_index,
  updated_at)` — persistent agent task state; this is owned jointly by Tracks
  A and C and is added through a joint migration

Embedding dimension is fixed at 1536 (Bedrock Titan Embeddings default).
If you change embedding model, update this file and ping the team — every
track's vector queries assume this dimension.

For correction-memory lookups, `doc_type` is obtained by joining
`corrections.transaction_id` through `transactions.document_id` to
`documents.doc_type`; do not add a duplicate `doc_type` column to
`corrections`. Semantic similarity uses the related transaction embedding and
must always be filtered by `org_id`.

## 5. Security and data-handling rules (non-negotiable)

These exist because this is financial data, and because "production
readiness" is a named judging criterion.

1. **Redact before persisting.** Card numbers, beyond the last 4 digits, are
   never written to CockroachDB or left in S3-extracted text. Redaction
   happens in the Lambda extraction step (Track A), not downstream.
2. **Raw documents and structured data are separated.** Raw files live only
   in S3 with restricted, logged access. CockroachDB holds extracted fields
   and embeddings only.
3. **RBAC is enforced at the query layer**, not just hidden in the UI.
   `leadership` role can only run against aggregate views (see `D2`), never
   row-level `transactions` queries, unless explicitly elevated and logged.
4. **Every agent action is audited.** Any agent write (extraction saved,
   correction applied, template generated) calls the shared audit helper
   before returning success to the caller.
5. **No secrets in code or prompts.** AWS credentials, DB connection
   strings, and API keys come from environment variables / AWS Secrets
   Manager only. Never hardcode, never paste into a Bedrock prompt.
6. **Retention.** Raw documents in S3 auto-expire per the org's retention
   setting (default 7 years, configurable — see `D3`). Don't build features
   that assume indefinite retention.

## 6. Shared conventions everyone must follow

- **Audit helper:** all tracks import `lib/audit.ts` (`logAction(orgId,
  actorId, action, targetTable, targetId, detail)`) rather than writing to
  `audit_log` directly. This keeps the schema for that table stable even if
  the underlying write logic changes.
- **MCP access:** the agent talks to CockroachDB through the Managed MCP
  Server in read-only mode by default. Any write path goes through our own
  service layer (not raw MCP writes) so audit logging and redaction can't be
  bypassed.
- **Branching:** `track/{a,b,c,d}/{issue-number}-{short-desc}`. PRs into
  `main` require one review from a teammate on a different track — this is
  how we catch integration breaks early, given four people building in
  parallel.
- **Environment parity:** one shared CockroachDB Cloud cluster for dev, one
  for demo. Don't create ad hoc local schemas that drift from §4.
- **Definition of done for any issue:** code merged, audit logging in place
  for any new write path, README section updated if it changes how to run
  the project, and — if the issue touches a required tool — one line added
  to `docs/tool-usage.md` describing what the agent actually did with it
  (this file becomes the basis for the submission writeup).

## 7. Track ownership (see ISSUES.md for the full breakdown)

| Track | Focus | Primary tables/services owned |
|---|---|---|
| A | Ingestion & core data model | `documents`, `transactions` (write path), S3, Lambda |
| B | Semantic memory layer | `templates`, embeddings, vector queries, MCP integration |
| C | Agent orchestration | Bedrock agent, session state, `corrections` |
| D | Compliance & delivery | RBAC, `audit_log` consumers, leadership views, deployment, demo |

If your issue requires touching another track's table, open a short thread
in the issue first — schema changes need agreement since three other people
are coding against the same contract.
