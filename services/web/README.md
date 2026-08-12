# @fiscus/web

Front-end for Fiscus: the volunteer-facing document-processing UI plus the leadership dashboard.
Design language: "ledger with a memory" — Fraunces serif display, JetBrains Mono figures, ink-on-paper palette.

## Run
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build
```

## Status
Feature-complete on a typed in-memory **mock layer** — runs with zero backend. Set `VITE_USE_MOCK=false`
and wire the real client in `src/api/index.ts` once `services/api` is live.

## Pages
| Route | What it does | Charter tie-in |
|---|---|---|
| `/` | Role-aware home: stats, session-resume card, activity, learned rules | C2 sessions, C3 memory |
| `/upload` | Drag-drop upload, validation (PDF/JPG/PNG ≤15MB), progress, error states | A2 (S3+Lambda) |
| `/review` | Queue, pending-first, plain-language guidance | — |
| `/review/:id` | Extracted fields with confidence meters; corrections → "I'll remember that" toast | C3 learned memory |
| `/templates` | Agent-proposed templates, expandable field lists, reviewer approval | B2 |
| `/assistant` | Agent chat with citations, suggestion chips, `?q=` deep-links, follow-up context | C1/C2, B4 (MCP) |
| `/activity` | Append-only audit feed with actor/action filters | C4, audit helper |
| `/dashboard` | Aggregate-only leadership view + "ask the agent" presets | D1 RBAC, D2 views |
| header | Semantic search over records | B3 (vector index) |

## The RBAC demo
The "demo" role switcher (top right) shows query-layer RBAC visually: each role only sees the controls
it may issue queries for; `leadership` is aggregate-only. Real enforcement is server-side (issue D1) —
the switcher exists so judges can see the behavior without four logins.

## Contract
`src/types.ts` mirrors the AGENTS.md data model. `src/api/client.ts` is the single interface the UI
codes against — change the contract there first, then the mock, then ping the team.
