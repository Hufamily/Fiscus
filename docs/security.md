# Security: RBAC enforcement (D1)

Implements AGENTS.md §5.3: RBAC is enforced at the query layer, not just
hidden in the UI. Server-side enforcement lives in [`lib/rbac.ts`](../lib/rbac.ts).

## Model

Access is expressed as capabilities, not raw table permissions, so the same
matrix reads the same way in the UI and on the server:

| Capability | data_entry | reviewer | treasurer | leadership |
|---|---|---|---|---|
| `upload_documents` (own uploads only) | ✅ | | | |
| `review_extractions` | ✅ | ✅ | ✅ | |
| `apply_corrections` (own uploads only) | ✅ | ✅ | | |
| `approve_templates` | | ✅ | ✅ | |
| `view_row_level_transactions` | ✅ | ✅ | ✅ | |
| `view_aggregate_reports` | | | ✅ | ✅ |

`leadership` never receives `view_row_level_transactions` — per AGENTS.md
§5.3 it is restricted to aggregate views (D2) "unless explicitly elevated
and logged," and no elevation path exists yet, so today the answer is
simply: never.

This matrix mirrors [`services/web/src/lib/rbac.ts`](../services/web/src/lib/rbac.ts),
the front-end's UI-only copy. That file says outright that the real
enforcement lives here. There is no shared package between the root `lib/`
(Node) and `services/web` (browser bundle), so the two copies are a
deliberate, documented duplication — **if the matrix changes, update both
files in the same PR.**

## How to enforce it

Every write or read path that touches `documents` or `transactions` calls
`enforceAccess(subject, request)` before doing the underlying query. On
denial it throws `AccessDeniedError` *and* writes an `access_denied` row to
`audit_log` via `lib/audit.ts` first, so denied attempts are themselves
audited (D1 acceptance criteria) — not just silently rejected.

`requireCapability(...)` wraps `enforceAccess` as a generic `(req, res,
next)` middleware factory. `services/api` has no HTTP framework chosen yet
(it's still a stub — see `services/api/README.md`), so this is written
against the shape common to Express/Connect rather than a specific router;
wire it in as soon as one lands instead of duplicating the access check
per handler.

`data_entry` gets an extra ownership check beyond the capability lookup:
`upload_documents` and `apply_corrections` additionally require
`request.uploadedBy === subject.volunteerId` (fails closed if `uploadedBy`
is unknown) — this is the "write-own-uploads only" restriction from the D1
spec, layered on top of the capability matrix rather than baked into it,
since it's the one capability pair that's owner-scoped instead of
role-scoped.

## What's *not* done yet (open follow-up)

The issue's technical spec says to "prefer CockroachDB row-level security /
column-level grants where practical, backed by application-layer checks as
a second line of defense." Only the second line — the application-layer
checks above — is implemented here. CockroachDB-native row-level security
was left out for now because:

- `services/api` has no live endpoints or connection-pooling story yet
  (see stub above), so there's no per-request identity to `SET ROLE` to
  ahead of a query — RLS needs that plumbing to mean anything.
- Wiring RLS policies now, untested against real multi-role traffic, risks
  a false sense of coverage more than it adds one.

Whoever builds the first real `services/api` endpoints should revisit
adding CockroachDB `ROW LEVEL SECURITY` / `CREATE POLICY` as the first line
of defense once there's an actual request pipeline to attach a role to —
`lib/rbac.ts` should stay in place regardless as the second line either way.

## Testing

`test/rbac.test.ts` covers the acceptance criteria directly:

- each role can only reach the capabilities it should (including the
  `data_entry` ownership check and the `leadership` negative case for
  row-level transactions)
- `enforceAccess` audit-logs denied attempts and does *not* log allowed ones
