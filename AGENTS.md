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

**This section is generated/verified against the live shared CockroachDB
Cloud dev cluster, not aspirational.** Last verified 2026-08-18 against
migrations `001`-`004` (see `db/migrations/`); full `SHOW CREATE TABLE` /
`SHOW INDEXES` dump lives in [`docs/schema.md`](docs/schema.md). If you
change the schema, **you must update both this section and
`docs/schema.md` in the same PR** — see the enforcement rule in §6, CI
will fail the PR otherwise.

All tables live in the cluster's `defaultdb` database (the CockroachDB
Cloud default — see `COCKROACH_DATABASE_URL` in `.env`). Earlier drafts of
this file called it `orgfinance`; that name was never actually applied
anywhere and the shared cluster has run as `defaultdb` since A1 first
applied migrations to it. `defaultdb` is the real name going forward —
don't reintroduce `orgfinance` in code or docs.

Every tenant-scoped table carries `org_id UUID NOT NULL` for multi-tenant
isolation, even in the demo. `organizations` is the tenant root and is the
sole exception.

Core tables, as actually created by `db/migrations/001`-`004`:

- `organizations(id UUID PK, name TEXT, retention_years INT DEFAULT 7, created_at)`
- `volunteers(id UUID PK, org_id FK, role, display_name)` — `role` is a
  real CockroachDB `ENUM` type (`volunteer_role`): `data_entry`,
  `reviewer`, `treasurer`, `leadership`
- `documents(id UUID PK, org_id FK, s3_key, doc_type, status, uploaded_by, created_at)`
  — never store raw file bytes here, only the S3 pointer. `status` has a
  `CHECK (status IN ('uploaded','extracting','needs_review','approved','rejected'))`
  from B1's stopgap migration (002); this predates A1 and wasn't loosened
  even though the intent was an open vocabulary — flagged as an open
  question in `docs/schema.md` for whoever owns `documents.status` to
  confirm/fix. `uploaded_by` is plain `TEXT`, not a FK to `volunteers` —
  the ingestion pipeline also writes system-actor labels (e.g.
  `'cli-system'`) here, not just human volunteers.
- `templates(id UUID PK, org_id FK, form_type, schema_json JSONB,
  embedding VECTOR(1536), status, created_at)` — `status` is
  `CHECK (status IN ('pending_review','approved'))`, matching this file's
  original intent exactly. `VECTOR INDEX templates_org_embedding_idx
  (org_id, embedding vector_l2_ops)` is live (added in A1/004).
- `transactions(id UUID PK, org_id FK, document_id FK, category,
  amount_cents, currency, txn_date, extracted_fields_json JSONB,
  embedding VECTOR(1536), status, created_at)` — same open-status-vocab
  flag as `documents.status` applies here (`CHECK` added by B1's 002,
  predates A1). `VECTOR INDEX transactions_org_embedding_idx (org_id,
  embedding vector_l2_ops)` is live (added in A1/004), plus a plain
  `(org_id, created_at DESC)` index from B1.
- `corrections(id UUID PK, org_id FK, transaction_id FK, field,
  original_value, corrected_value, corrected_by UUID NOT NULL FK ->
  volunteers, created_at)` — this is the "learned memory" table; the
  agent reads recent corrections for an org before extracting new
  documents of the same type. Added in A1/004.
- `audit_log(id UUID PK, org_id FK, actor_id TEXT, action, target_table,
  target_id, detail_json JSONB, created_at)` — append-only, every write
  from every track goes through the audit helper (see §6), no exceptions.
  `actor_id` is untyped `TEXT`, no FK to `volunteers` — the agent itself
  can be the actor.
- `sessions(id UUID PK, org_id FK, volunteer_id TEXT, pending_documents
  JSONB, current_index, updated_at)` — persistent agent task state. Spec
  says this is owned jointly by Tracks A and C and added through a joint
  migration; in practice C1 (`003_c1_sessions.sql`) added it solo before
  A1 ever ran, since nobody had applied migrations to the real cluster
  yet. Noting what happened, not changing the ownership rule for next
  time.

Embedding dimension is fixed at 1536 (Bedrock Titan Embeddings default).
If you change embedding model, update this file and ping the team — every
track's vector queries assume this dimension.

For correction-memory lookups, `doc_type` is obtained by joining
`corrections.transaction_id` through `transactions.document_id` to
`documents.doc_type`; do not add a duplicate `doc_type` column to
`corrections`. Semantic similarity uses the related transaction embedding and
must always be filtered by `org_id` — both vector indexes are prefixed on
`org_id` for exactly this, so an unfiltered query won't use the index.

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
- **Git workflow for agents (human or Codex/Claude/etc.):** push only to a
  `track/{a,b,c,d}/{issue-number}-{short-desc}` branch, never directly to
  `main`. Land changes as new commits — don't amend or rebase-rewrite a
  commit that's already been pushed, since teammates may have already
  fetched it. Opening the PR into `main` is a manual, human step; an agent
  finishing work on a branch should stop there and hand it back rather than
  running `gh pr create` itself.
- **Environment parity:** one shared CockroachDB Cloud cluster for dev, one
  for demo. Don't create ad hoc local schemas that drift from §4.
- **Schema changes force a doc update, in the same PR — CI enforces this.**
  Any PR that adds/edits a file under `db/migrations/` must also touch
  `AGENTS.md` and `docs/schema.md` in that same PR, or the
  `schema-docs-sync` CI job fails the build (see `.github/workflows/ci.yml`).
  This exists because §4 drifted from reality once already: 001-003 sat in
  `db/migrations/` for a while without ever being applied to the real
  cluster, and this file kept describing a `orgfinance` database that
  never existed. Don't rely on remembering to update the docs — regenerate
  `docs/schema.md` from `SHOW CREATE TABLE`/`SHOW INDEXES` against the real
  cluster and hand-edit the §4 summary to match before you open the PR.
- **Definition of done for any issue:** code merged, audit logging in place
  for any new write path, README section updated if it changes how to run
  the project, and — if the issue touches a required tool — one line added
  to `docs/tool-usage.md` describing what the agent actually did with it
  (this file becomes the basis for the submission writeup).
- **.env file**check .env.example for context on what's in the .env file. API Keys and passwords are only in the .env file.

## 7. Track ownership

| Track | Focus | Primary tables/services owned |
|---|---|---|
| A | Ingestion & core data model | `documents`, `transactions` (write path), S3, Lambda |
| B | Semantic memory layer | `templates`, embeddings, vector queries, MCP integration |
| C | Agent orchestration | Bedrock agent, session state, `corrections` |
| D | Compliance & delivery | RBAC, `audit_log` consumers, leadership views, deployment, demo |

If your issue requires touching another track's table, open a short thread
in the issue first — schema changes need agreement since three other people
are coding against the same contract.
