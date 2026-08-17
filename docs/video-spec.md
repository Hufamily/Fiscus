# Demo video — production spec (deadline day)

Owner: Bryan (script, filming, edit). This doc is the single source of truth for the video. Full narration script with per-beat lines lives with Bryan; this is the team-facing shot list and who provides what.

## Hard requirements (from Devpost + issue D4)

- Under 3 minutes. Uploaded to YouTube or Vimeo, set PUBLIC. Link goes in README + Devpost form.
- Must show **the CockroachDB memory layer at work — not just the UI**. D4 names four proof shots: a vector search hit, a resumed session, a correction being reused, an audit log.
- Must make clear which CockroachDB tools + AWS services the agent used.

## Structure (3 acts, ~2:40 total)

**Act 1 — Problem + product (0:00–0:50).** Screen: live site (fiscus-blue.vercel.app). Volunteer story: upload a receipt, agent extracts, reviewer corrects the flagged low-confidence field, approves, "I'll remember that" toast. This act can run entirely on the polished front-end regardless of backend status.

**Act 2 — PROOF: memory is real (0:50–2:00).** This is the act judges are told to look for and the one that cannot be UI-only. Screen: CockroachDB Cloud console SQL shell + terminal, intercut with UI. The four proof shots in priority order:

| # | Proof shot | Minimum viable version | Who provides it | Fallback if not ready |
|---|---|---|---|---|
| 1 | **Audit log** | Run B2 template-gen live in terminal → `SELECT action, target_table, created_at FROM audit_log ORDER BY created_at DESC LIMIT 5;` in console shows the rows appear | Bryan (B2 real mode) — needs cluster string + AWS creds | None needed; this is the safest shot |
| 2 | **Vector search hit** | After B2 stores a template embedding: run a `<->` similarity query in the SQL shell showing nearest-template ordering with distances | Bryan (B2) + whoever has the cluster | Show the `VECTOR(1536)` column + stored embedding row and narrate the query |
| 3 | **Correction being reused** | Insert a correction row; re-run extraction on a similar doc; show the corrected vendor applied automatically | Ethan/Eric (extraction pipeline) | Show `corrections` rows in DB + the front-end "agent has learned" panel; narrate the loop honestly as "stored and surfaced" |
| 4 | **Resumed session** | `sessions` row in DB + the "pick up where you left off" card resuming to the right doc | Eric (C2) | CUT this beat (weakest; 3 proofs suffice) and give its 15s to shot 2 |

**Act 3 — Architecture + close (2:00–2:40).** Screen: README architecture diagram. Name the tools: CockroachDB (vector indexing, managed MCP read-only for the agent), AWS (S3, Lambda, Bedrock ×2). One-line close: "the org's knowledge compounds — that's memory as the product."

If the chat agent (C1/MCP) is live by filming: 10-second insert in Act 2 — ask "what's pending review?", show the cited answer, mention it reads through the managed MCP server read-only. If not live: MCP stays in Act 3 narration only. Do not fake it on camera.

## What each person owes, and by when

- **Ethan:** cluster connection string + SQL-shell access for filming; repo flipped PUBLIC; merge README PR. If extraction round-trip will be ready, say so by early evening so shot 3 upgrades from fallback.
- **Eric:** AWS creds (region + Bedrock model access for Claude + Titan-embed). Chat agent status call by early evening (in or out of the video).
- **Aaron:** watch the rough cut as the "does this actually prove memory?" reviewer — you know the redaction/audit path best.
- **Bryan:** B2 live run, all screen recording, narration, edit to <3:00, upload, links into README + Devpost.

## Recording logistics

- 1440p screen recording, 100% browser zoom, notifications off, slow deliberate cursor.
- Record each act as a separate clip; retakes are per-act, not whole-video.
- Record the SQL-shell shots FIRST once creds arrive (they're the ones that can surprise); UI act any time.
- Narration recorded after picture-lock, read from script — no improvising under deadline adrenaline.
- Budget: shots by ~2h before submission, edit 45 min, upload + link-paste 15 min. Nothing records in the final hour.
