# Schema

Generated from `SHOW CREATE TABLE` / `SHOW INDEXES` against the shared
CockroachDB Cloud dev cluster (see `.env` / `COCKROACH_DATABASE_URL`) after
applying `db/migrations/001` through `004`. Authoritative source of truth
is `AGENTS.md` §4; this file documents what was actually built and any
open assumptions for the owning track to confirm. Regenerate by re-running
the `SHOW CREATE TABLE` queries below if the schema changes.

**Note:** AGENTS.md §4 says tables live in a database named `orgfinance`.
The cluster's actual database (from the connection string in `.env`) is
`defaultdb` — nothing in this repo creates or references an `orgfinance`
database. A1 applied migrations to `defaultdb` rather than inventing a
database rename other tracks aren't expecting; flagging this as a
discrepancy between AGENTS.md and the actual shared cluster for the team
to reconcile (either update AGENTS.md, or rename the database — either is
a one-line change, but it's a cross-track decision, not A1's to make
unilaterally).

Migration history:

| File | Track | Adds |
|---|---|---|
| `001_b2_minimal.sql` | B2 | `organizations`, `templates`, `audit_log` |
| `002_b1_docs_transactions.sql` | B1 | `documents`, `transactions` |
| `003_c1_sessions.sql` | A+C (joint) | `sessions` |
| `004_a1_volunteers_corrections_indexes.sql` | A1 | `volunteers`, `corrections`, vector indexes on `templates.embedding` and `transactions.embedding` |
| `005_d2_summaries.sql` | D2 | `summaries` (additive, not in the original §4 contract) |

001-003 were written as minimal stopgaps by other tracks so development
could start before A1 landed (see the comments in each file). This issue
(A1) is what actually applied them for real for the first time — the
shared dev cluster had no tables at all before this — and added the two
remaining tables plus the real vector indexes.

## organizations

Tenant root. Sole table without `org_id`.

```sql
CREATE TABLE public.organizations (
	id UUID NOT NULL DEFAULT gen_random_uuid(),
	name STRING NOT NULL,
	retention_years INT8 NOT NULL DEFAULT 7:::INT8,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now():::TIMESTAMPTZ,
	CONSTRAINT organizations_pkey PRIMARY KEY (id ASC)
);
```

## volunteers

```sql
CREATE TABLE public.volunteers (
	id UUID NOT NULL DEFAULT gen_random_uuid(),
	org_id UUID NOT NULL,
	"role" public.volunteer_role NOT NULL,
	display_name STRING NOT NULL,
	CONSTRAINT volunteers_pkey PRIMARY KEY (id ASC),
	CONSTRAINT volunteers_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id)
);
```

`role` is a real CockroachDB `ENUM` (`volunteer_role`), per AGENTS.md §4's
explicit closed set: `data_entry`, `reviewer`, `treasurer`, `leadership`.

## documents

```sql
CREATE TABLE public.documents (
	id UUID NOT NULL DEFAULT gen_random_uuid(),
	org_id UUID NOT NULL,
	s3_key STRING NOT NULL,
	doc_type STRING NOT NULL,
	status STRING NOT NULL DEFAULT 'approved':::STRING,
	uploaded_by STRING NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now():::TIMESTAMPTZ,
	CONSTRAINT documents_pkey PRIMARY KEY (id ASC),
	CONSTRAINT documents_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id),
	CONSTRAINT documents_status_check CHECK (status IN ('uploaded', 'extracting', 'needs_review', 'approved', 'rejected'))
);
```

**Open assumptions (flagging for Track A/B to confirm, not decided here):**
- `status` has a `CHECK` constraint restricting it to 5 values. AGENTS.md §4
  says `documents.status` is *not* a fully-enumerated closed vocabulary —
  this constraint was added by B1's stopgap migration (002) before A1
  landed. A1 left it as-is rather than loosening it on a live table, since
  loosening is easy later and tightening after data exists is not. If the
  open-vocabulary intent matters before submission, drop the CHECK in a
  follow-up migration.
- `uploaded_by` is `STRING`, not a FK to `volunteers.id`. AGENTS.md §4
  doesn't type this column, and it's already populated by the ingestion
  pipeline with system actor labels (e.g. `'cli-system'`) as well as human
  volunteers — same ambiguity as `audit_log.actor_id` (§6: "may not always
  map to a `volunteers` row"). A1 left it untyped rather than forcing a FK
  that would break system-actor writes.
- `s3_key` is a pointer only, per AGENTS.md §5.2 — never raw bytes.

## templates

```sql
CREATE TABLE public.templates (
	id UUID NOT NULL DEFAULT gen_random_uuid(),
	org_id UUID NOT NULL,
	form_type STRING NOT NULL,
	schema_json JSONB NOT NULL,
	embedding VECTOR(1536) NULL,
	status STRING NOT NULL DEFAULT 'pending_review':::STRING,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now():::TIMESTAMPTZ,
	CONSTRAINT templates_pkey PRIMARY KEY (id ASC),
	CONSTRAINT templates_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id),
	VECTOR INDEX templates_org_embedding_idx (org_id, embedding vector_l2_ops),
	CONSTRAINT templates_status_check CHECK (status IN ('pending_review', 'approved'))
);
```

`status`'s two-value CHECK matches AGENTS.md §4 exactly ("`status` is
`pending_review` until a reviewer approves it") so it was left in place —
this one *is* a closed vocabulary per spec, unlike `documents.status`.

## transactions

```sql
CREATE TABLE public.transactions (
	id UUID NOT NULL DEFAULT gen_random_uuid(),
	org_id UUID NOT NULL,
	document_id UUID NOT NULL,
	category STRING NOT NULL,
	amount_cents INT8 NOT NULL DEFAULT 0:::INT8,
	currency STRING NOT NULL DEFAULT 'USD':::STRING,
	txn_date DATE NULL,
	extracted_fields_json JSONB NULL,
	embedding VECTOR(1536) NULL,
	status STRING NOT NULL DEFAULT 'pending_review':::STRING,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now():::TIMESTAMPTZ,
	CONSTRAINT transactions_pkey PRIMARY KEY (id ASC),
	CONSTRAINT transactions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id),
	CONSTRAINT transactions_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id),
	INDEX transactions_created_at_idx (org_id ASC, created_at DESC),
	VECTOR INDEX transactions_org_embedding_idx (org_id, embedding vector_l2_ops),
	CONSTRAINT transactions_status_check CHECK (status IN ('pending_review', 'approved', 'rejected'))
);
```

Same open-vocabulary flag as `documents.status` applies to `transactions.status`
— its 3-value CHECK also predates A1 (from B1's stopgap) and wasn't loosened
for the same reason.

## corrections

```sql
CREATE TABLE public.corrections (
	id UUID NOT NULL DEFAULT gen_random_uuid(),
	org_id UUID NOT NULL,
	transaction_id UUID NOT NULL,
	field STRING NOT NULL,
	original_value STRING NULL,
	corrected_value STRING NOT NULL,
	corrected_by UUID NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now():::TIMESTAMPTZ,
	CONSTRAINT corrections_pkey PRIMARY KEY (id ASC),
	CONSTRAINT corrections_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id),
	CONSTRAINT corrections_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id),
	CONSTRAINT corrections_corrected_by_fkey FOREIGN KEY (corrected_by) REFERENCES public.volunteers(id)
);
```

No `doc_type` column, per AGENTS.md §4 — get it by joining
`corrections.transaction_id -> transactions.document_id -> documents.doc_type`:

```sql
SELECT c.*, d.doc_type
FROM corrections c
JOIN transactions t ON t.id = c.transaction_id
JOIN documents d ON d.id = t.document_id
WHERE c.org_id = $1;
```

`corrected_by` is `NOT NULL REFERENCES volunteers(id)` — unlike
`audit_log.actor_id` and `documents.uploaded_by`, a correction is by
definition a human reviewer action, so the FK is safe to enforce here.

## audit_log

```sql
CREATE TABLE public.audit_log (
	id UUID NOT NULL DEFAULT gen_random_uuid(),
	org_id UUID NOT NULL,
	actor_id STRING NOT NULL,
	action STRING NOT NULL,
	target_table STRING NOT NULL,
	target_id STRING NOT NULL,
	detail_json JSONB NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now():::TIMESTAMPTZ,
	CONSTRAINT audit_log_pkey PRIMARY KEY (id ASC),
	CONSTRAINT audit_log_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id)
);
```

`actor_id` is `STRING`, no FK to `volunteers` — per AGENTS.md §6, the agent
itself can be the actor, so it may not map to a `volunteers` row. Always
write through `lib/audit.ts`'s `logAction`, never insert directly (§6).

## sessions

Owned jointly by Tracks A and C; added by `003_c1_sessions.sql` before A1
landed, not by this issue. Included here for completeness.

```sql
CREATE TABLE public.sessions (
	id UUID NOT NULL DEFAULT gen_random_uuid(),
	org_id UUID NOT NULL,
	volunteer_id STRING NOT NULL,
	pending_documents JSONB NOT NULL DEFAULT '{}':::JSONB,
	current_index INT8 NOT NULL DEFAULT 0:::INT8,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now():::TIMESTAMPTZ,
	CONSTRAINT sessions_pkey PRIMARY KEY (id ASC),
	CONSTRAINT sessions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id),
	INDEX sessions_org_volunteer_idx (org_id ASC, volunteer_id ASC)
);
```

## summaries

Additive table from D2, not part of the original §4 contract — flagged
here per §6's schema-doc-sync rule rather than silently added.

```sql
CREATE TABLE public.summaries (
	id UUID NOT NULL DEFAULT gen_random_uuid(),
	org_id UUID NOT NULL,
	period_label STRING NOT NULL,
	body STRING NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now():::TIMESTAMPTZ,
	CONSTRAINT summaries_pkey PRIMARY KEY (id ASC),
	CONSTRAINT summaries_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id),
	INDEX summaries_org_period_idx (org_id ASC, period_label ASC, created_at DESC)
);
```

Generated by `services/api/summaries` (`npm run summary:generate`) from an
aggregate-only query (`GROUP BY category, status` on `transactions` — no
row-level data crosses the boundary) fed to Bedrock. Gated by D1's
`view_aggregate_reports` capability (`lib/rbac.ts`) — only `treasurer` and
`leadership` can trigger generation; a denied attempt is itself
audit-logged.

## Vector indexes

Both `templates.embedding` and `transactions.embedding` have a
**Distributed Vector Index** (CockroachDB v25.2+ feature; cluster is
v26.2.5), confirmed via `SHOW CREATE TABLE` printing `VECTOR INDEX`
explicitly in the reconstructed DDL:

```
VECTOR INDEX templates_org_embedding_idx (org_id, embedding vector_l2_ops)
VECTOR INDEX transactions_org_embedding_idx (org_id, embedding vector_l2_ops)
```

`org_id` is the leading/prefix column on both, so CockroachDB partitions
the index per tenant — this is what makes "always filter similarity search
by `org_id`" (AGENTS.md §4) enforceable at the index level rather than a
convention callers have to remember. Verified with `EXPLAIN` that an
org-scoped `ORDER BY embedding <-> $1 LIMIT n` query actually plans through
`transactions_org_embedding_idx` rather than a full scan.

Operator class is the default `vector_l2_ops` (`<->`, L2/Euclidean
distance) to match the existing query code in
`services/ingestion/embeddings/src/client.ts` (`searchTransactions`), which
already used `<->` before an index existed for it to use.

Enabling this required `SET CLUSTER SETTING feature.vector_index.enabled = true`
(part of migration 004) — the connecting role needs `MODIFYCLUSTERSETTING`.

## Migration tool

Plain versioned `.sql` files under `db/migrations/`, applied in filename
order by a small `pg`-based runner (`db/migrate.ts`, invoked via
`db/migrate.sh` / `npm run db:migrate`). Chose this over a dedicated tool
like `dbmate`: every migration so far was already written as raw `.sql` by
other tracks, `pg` is already a dependency every service uses, and adding
a new binary wasn't worth it against the hackathon deadline. Applied
migrations are tracked in a `schema_migrations(filename, applied_at)`
table so re-running is a no-op.

See the [README](../README.md#backend) for exact run commands.
