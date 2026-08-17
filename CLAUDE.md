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
