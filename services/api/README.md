# API service (Track B / D)

Shared API layer: semantic search endpoints (B3), MCP integration (B4),
RBAC middleware (D1), leadership reporting views (D2). The authoritative
data and security contract is [`AGENTS.md`](../../AGENTS.md).

**D1 (RBAC enforcement):** the access-control logic itself lives in
[`lib/rbac.ts`](../../lib/rbac.ts) (`enforceAccess` / `requireCapability`),
not here — there's no HTTP framework/router in this service yet for it to
attach to. See [`docs/security.md`](../../docs/security.md) for the model.
Whoever builds the first real endpoint here should wire `requireCapability`
into it rather than hand-rolling a new access check.

## HTTP server (issue #26)

`src/` is a minimal Express server exposing the `FiscusApi` shape
(`services/web/src/api/client.ts`) at `/api/*`, so the front-end's real
client (`services/web/src/api/http.ts`) has something to talk to. It
delegates rather than reimplements:

- `services/agent/src/agent.ts` (`ask()`) — volunteer Q&A
- `services/ingestion/embeddings` (`embed()` + `searchTransactions()`) — semantic search
- `services/api/summaries/src/generate.ts` (`generateSummary()`) — RBAC-gated leadership aggregates
- `lib/rbac.ts` (`requireCapability()` / `enforceAccess()`) — every route
- `lib/audit.ts` — every write path

`src/db.ts` covers the pieces with no existing dedicated module (org,
volunteers, documents, transactions, corrections, templates, activity feed).
It intentionally does **not** import `services/ingestion/template-gen`'s
source directly — that module pins its own `zod@^3` in an isolated
`package.json` specifically so it doesn't conflict with the root's
`zod@^4`; importing it into a file compiled under the root `tsconfig.json`
(as `src/` is) would reintroduce that exact conflict. The small
get/approve/list logic for templates is duplicated locally instead, using
the same audit action name (`template_approved`) the CLI module uses.

Auth is a placeholder, documented as such: the caller identifies via an
`x-fiscus-volunteer-id` header (`src/auth.ts`), defaulting to the
`data_entry` demo volunteer if absent. There's no real session/JWT layer
yet — see `services/web/src/api/actorState.ts` for how the front-end's role
switcher threads an identity through.

### Setup

```
npm install                # root deps (express, pg, aws-sdk, …)
npm run api:dev             # tsx services/api/src/index.ts, listens on :8080
```

Mock mode (default, no `COCKROACH_DATABASE_URL` / AWS credentials) reads and
writes `fixtures/mock-db.json`. Real mode requires both set (mirrors every
other module's `IS_MOCK` check).

Point the front-end at it via `services/web/.env`:

```
VITE_USE_MOCK=false
VITE_API_BASE_URL=http://localhost:8080/api
```
