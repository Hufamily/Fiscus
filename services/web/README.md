# @fiscus/web

Front-end for Fiscus: the volunteer-facing document-processing UI plus the leadership dashboard.

## Status
First scaffold. Built against the `services/api` contract with an in-memory **mock layer**, so it runs
with zero backend dependencies. Swap in the real client by setting `VITE_USE_MOCK=false` and wiring
`src/api/index.ts` once `services/api` is live.

## Run
```bash
npm install
npm run dev      # http://localhost:5173
```

## What's here
- **Volunteer flow** — upload (`/upload`), review queue (`/review`), review-and-correct detail
  (`/review/:docId`), template approval (`/templates`). Corrections are captured the way the charter's
  `corrections` "learned memory" table expects.
- **Leadership dashboard** (`/dashboard`) — aggregate-only spend views, backing the D2 leadership
  reporting views.
- **RBAC demo** — a role switcher (top right) shows the charter's query-layer RBAC (section 5):
  each role only sees the controls it is allowed to issue queries for; `leadership` is aggregate-only.

## Contract
`src/types.ts` mirrors the AGENTS.md data model. `src/api/client.ts` is the interface the UI codes
against. If the charter schema changes, update `types.ts` first, then the mock, then ping the team.
