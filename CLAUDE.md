# Fiscus — Claude Code context

Hackathon project (CockroachDB × AWS "Build with Agentic Memory", deadline Aug 18 2026). Agentic bookkeeping for volunteer orgs; CockroachDB is the agent's memory.

**Read AGENTS.md first — it is the team's charter and integration contract.** Schema shapes (§4), security rules (§5), and shared conventions (§6) are non-negotiable; if an issue disagrees with AGENTS.md, AGENTS.md wins.

## Conventions / gotchas

- TypeScript monorepo; four teammates build in parallel against the §4 schema contract. Don't fork table shapes.
- Bryan owns the front-end (`services/web`, complete, deployed at https://fiscus-blue.vercel.app) and is now building backend issue B2.
- Branching: `track/{track}/{issue}-{desc}`; PRs into main need one cross-track review.
- The root .gitignore previously had a Python-template `lib/` rule that silently excluded lib folders — fixed, but if files ever vanish from commits, run `git check-ignore -v <path>`.
- Redaction before Bedrock, always (§5). Card numbers never leave a process unredacted.
- All writes audit via `lib/audit.ts`; embeddings are fixed at 1536 dims (Titan).
- PRD.md files here are Bryan's personal build specs — do not commit them unless asked.

## Learnings

At the end of every session, append one line here: what broke, or what you'd do differently.
- B2 (2026-08-18): Aaron's `lib/redact.ts` was already merged (Luhn-validated); fake card numbers in fixtures must pass the Luhn check or they won't be redacted — use standard test numbers (4111 1111 1111 1111) not invented ones. Also: `npm run` scripts on Windows can't use `node_modules/.bin/tsx` directly — just `tsx` works because npm adds `.bin` to PATH automatically.
- B1/C1/D2 (2026-08-18): PowerShell here-strings (`@'...'@`) can't contain single-quoted apostrophes — git commit messages with contractions ("don't") break the heredoc. Use a temp file for complex PR bodies and `git commit -m "..."` with escaped content for messages. Also: `sessions.pending_documents` JSONB repurposed for Q&A conversation history works but is semantically wrong — future migrations should add a dedicated column rather than repurposing document-queue fields.
- A1 (2026-08-18): the shared dev cluster had zero tables before this session — B1/B2/C1 all developed against mock-db.json fixtures and never actually ran their migrations for real, despite 001-003 already existing in db/migrations/. Don't assume a migration file existing means it's been applied anywhere. Also: this sandboxed session had no Node.js at all (not just missing tsx-on-PATH) and no working cockroach/DB MCP tool despite the issue text claiming one — had to verify the schema by reading `.env`'s COCKROACH_DATABASE_URL directly and hitting the cluster with Python/psycopg2 in a throwaway `.venv` (already gitignored) as a stand-in for the real `pg`-based TS runner. `.env` in this repo uses `KEY = "value"` (spaces + quotes) not plain dotenv `KEY=value` — a naive regex/parser will silently miss it.
- D1 (2026-08-18): before writing server-side RBAC, check `services/web/src/lib/rbac.ts` — Bryan's front end already has a real capability matrix and its header says outright the UI copy is decorative and "the real enforcement lives in services/api / D1." Mirror that matrix exactly rather than inventing a different permission model from the issue's prose spec; the two disagreed slightly (issue text implied data_entry has no transaction visibility, the UI matrix grants `view_row_level_transactions` to data_entry) and the deployed UI won. Also: this sandboxed session again had zero Node.js (same as A1's note) — couldn't run `vitest`/`tsc` locally at all, had to review the TS by eye and rely on CI/the user to actually execute `npm test`.
