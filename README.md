# Fiscus

An agentic storage layer for financial document processing at volunteer
organizations, built with CockroachDB as the persistent agent memory layer.

Built for the [CockroachDB × AWS Hackathon](https://cockroachdb-ai.devpost.com/).

See [`AGENTS.md`](./AGENTS.md) for the full architecture, data model, and
integration rules — read that before opening a PR. See
[`ISSUES.md`](./ISSUES.md) for the task breakdown across the four project
tracks.

## Repo layout

```
services/
  ingestion/   # S3 → Lambda → CockroachDB extraction pipeline (Track A)
  agent/       # Bedrock agent orchestration (Track C)
  api/         # Shared API layer: RBAC, reporting views, audit (Track B/D)
db/
  migrations/  # CockroachDB schema migrations (Track A)
lib/           # Shared helpers used by every service (audit.ts, redact.ts, etc.)
docs/          # Architecture, schema, security docs, tool-usage log
```

## Setup

> Each service's own README (added as its track lands) will have
> service-specific run instructions. This section covers the shared
> prerequisites.

1. **CockroachDB Cloud cluster** — create a free serverless cluster at
   [cockroachlabs.cloud](https://cockroachlabs.cloud), grab the connection
   string, and set it as `COCKROACH_DATABASE_URL` in your local `.env`
   (copy `.env.example` to `.env` first — never commit `.env`).
2. **AWS account** — you'll need access to S3, Lambda, and Bedrock in
   whatever region your team standardizes on. Set `AWS_REGION` and use
   AWS SSO/credentials locally; never hardcode keys (see `AGENTS.md` §5,
   rule 5).
3. **Run migrations (after A1):**
   ```
   cd db && ./migrate.sh
   ```
   `db/migrate.sh` is currently a placeholder and exits without applying
   migrations. Track A will implement it in issue A1.
4. Each service directory will get its own install/run steps as it's built.

## Required hackathon tools

Tracked live in [`docs/tool-usage.md`](./docs/tool-usage.md) as PRs land.

- **CockroachDB:** Distributed Vector Indexing, Managed MCP Server, Agent
  Skills Repo
- **AWS:** S3, Lambda, Bedrock

## Team

Four tracks, one owner each — see `ISSUES.md` for the full breakdown.

| Track | Focus |
|---|---|
| A | Ingestion & core data model |
| B | Semantic memory layer |
| C | Agent orchestration |
| D | Compliance, reporting & delivery |
