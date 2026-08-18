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

## Setup

_TODO: fill in as B3 lands (install steps, how to run locally, auth setup)._
