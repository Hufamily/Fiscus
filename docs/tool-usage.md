# Tool usage log

Add one row every time a merged PR is the first to exercise a given tool.
This becomes the basis for the submission's "which tools did you use and
how" writeup — keep it accurate as you go, don't reconstruct it at the end.

## Required tools

| Category | Tool | Used? | How (fill in as implemented) | First PR |
|---|---|---|---|---|
| CockroachDB | Distributed Vector Indexing | ☑ | B1 embeddings: transactions.embedding VECTOR(1536) stores Titan embeddings; search.ts uses `<->` for similarity ranking. A1 added the actual `CREATE VECTOR INDEX` (org_id, embedding) on templates and transactions — before A1 there was no index behind the `<->` queries, just a full scan; confirmed via `SHOW CREATE TABLE` and `EXPLAIN` that org-scoped similarity queries now plan through the index. See docs/schema.md. | B1 (storage/query), A1 (actual index) |
| CockroachDB | Managed MCP Server | ☑ | B4/C: `services/agent/src/mcp-schema.ts` gives the agent a read-only schema-introspection capability over the Managed MCP Server (`https://cockroachlabs.cloud/mcp`) — "what does the transactions table look like" is answered via live `list_tables`/`get_table_schema` calls, not hardcoded column knowledge. See "MCP Server integration" below. | B4 (#9) |
| CockroachDB | Agent Skills Repo | ☐ | | |
| AWS | S3 | ☐ | | |
| AWS | Lambda | ☐ | | |
| AWS | Bedrock | ☑ | B2 template-gen: Claude 3.5 Haiku infers schema_json from 2+ example docs; Titan Embed Text v2 (1536 dims) computes the template embedding stored in CockroachDB | B2 |

## MCP Server integration (B4, issue #9)

### What it is

`services/agent/src/mcp-schema.ts` gives the volunteer Q&A agent
(`services/agent/src/agent.ts`) a second capability alongside its existing
Bedrock RAG path: read-only schema introspection over CockroachDB via the
**Managed MCP Server**, reached through the Cloud Console config snippet at
`https://cockroachlabs.cloud/mcp`. When `ask()` receives a question that
matches `/look like|schema|columns|structure|fields/i` (see
`SCHEMA_QUESTION_RE` in `agent.ts`), it calls `findMentionedTable()` to
resolve which table the question is about by checking the question's words
against a **live `list_tables()` call** — not a hardcoded table list — and,
if one matches, answers with the table's real `CREATE TABLE` statement from
`get_table_schema()`, with a citation pointing at the MCP tool call. Every
other question (aggregates, "how much did we spend on X") is unaffected and
still goes through the original embedding + Bedrock Converse path.

This satisfies the acceptance criterion "agent can answer 'what does the
transactions table look like' via MCP without hardcoded schema knowledge":
try it with `npm run agent:ask -- --question "what does the transactions
table look like"`.

### Tool surface used (verified against a live connection)

The three tools below were called directly against the shared dev cluster's
Managed MCP Server while building this feature (not simulated) to confirm
the real request/response shapes before writing `mcp-schema.ts` against
them:

| Tool | Arguments | Verified behavior |
|---|---|---|
| `list_tables` | `{database}` | Returned all 10 tables in `defaultdb.public`, live. |
| `get_table_schema` | `{database, table}` | Returned the exact `CREATE TABLE ...` DDL, including constraints and the `VECTOR INDEX` clauses — e.g. `transactions_org_embedding_idx (org_id, embedding vector_l2_ops)`. |
| `select_query` | `{database, query}` | A `SELECT ... GROUP BY category, status` aggregate query executed and returned real rows. |

`services/agent/fixtures/mock-mcp-schema.json` is a verbatim capture of
those `list_tables`/`get_table_schema` responses, used as the fallback
transport (see "Real vs. stubbed" below) — it is fixture data standing in
for the network call, not schema knowledge baked into the agent's prompts
or code.

### Write boundary — confirmed, not just documented

Per `AGENTS.md` §6: *"the agent talks to CockroachDB through the Managed
MCP Server in read-only mode by default. Any write path goes through our
own service layer (not raw MCP writes)."* Two independent pieces of
evidence back this up:

1. **The tool itself refuses writes.** Feeding a non-`SELECT` statement to
   the live `select_query` tool was tried directly against the shared
   cluster's MCP connection:
   ```
   select_query({ database: "defaultdb", query: "DELETE FROM transactions WHERE 1=0" })
   → error: "only SELECT statements are allowed, got DELETE"
   select_query({ database: "defaultdb", query: "INSERT INTO organizations (id, name) VALUES (...)" })
   → error: "only SELECT statements are allowed, got INSERT"
   ```
   Nothing was written; both statements were rejected before execution.
2. **The code has no write path to attempt.** `mcp-schema.ts`'s
   `SchemaIntrospector` interface exposes exactly three methods —
   `listTables`, `getTableSchema`, `selectQuery` — and `selectQuery` itself
   re-checks `assertReadOnly()` client-side (rejecting anything not matching
   `/^select\b/i`) before a request would ever leave the process. There is
   no `insertRows`/`update`/`delete`/`createTable` method anywhere in the
   module; `test/agent-mcp.test.ts` asserts this structurally. Any real
   write in this codebase (extraction results, corrections, summaries)
   continues to go through `lib/audit.ts` + the existing `pg` pool in
   `services/agent/src/client.ts`, entirely separate from this file.

   Note: the sandbox this feature was built in separately exposes broader
   admin-style MCP tools (`create_table`, `insert_rows`, `create_database`)
   used by earlier sessions (e.g. A1) to bootstrap the shared cluster's
   schema. Those are **not** part of the Cloud Console "read-only mode"
   config this issue wires up, and `mcp-schema.ts` does not call or wrap
   them — the production agent's MCP capability is scoped to the three read
   tools above only.

### Real vs. stubbed

- **Real:** `RemoteMcpIntrospector` in `mcp-schema.ts` is a genuine
  `@modelcontextprotocol/sdk` client (`Client` +
  `StreamableHTTPClientTransport`) pointed at `COCKROACH_MCP_URL` (defaults
  to `https://cockroachlabs.cloud/mcp`), calling `list_tables`,
  `get_table_schema`, and `select_query` with exactly the argument shapes
  verified above. It activates whenever `COCKROACH_MCP_API_KEY` is set.
- **Stubbed:** this sandbox had no `COCKROACH_MCP_API_KEY`/cluster
  credentials reachable from a plain Node process (`env | grep -i mcp`
  came back empty — the live MCP tool calls above went through this
  session's own Claude Code harness, not through `services/agent`'s Node
  process, and that harness's credentials aren't exposed as env vars). So
  `RemoteMcpIntrospector` compiles and typechecks against the real SDK but
  was **not** exercised end-to-end over a live network connection in this
  session. `MockIntrospector` (backed by `fixtures/mock-mcp-schema.json`,
  itself captured from the real connection above) is what actually ran in
  tests and the `npm run agent:ask` demo. Swapping one for the other is a
  single env var (`COCKROACH_MCP_API_KEY`) — `agent.ts` and `mcp-schema.ts`
  consumers only ever depend on the `SchemaIntrospector` interface, never
  on which implementation backs it.

## Notes for the final writeup

- Explain *why* each tool was the right fit, not just that it was used.
- Screenshots/log snippets of vector search results and MCP queries make
  the demo video and README much more convincing than a description alone.

## Front-end (services/web)
- **CockroachDB Distributed Vector Indexing (B3):** header search UI issues semantic queries over transaction/template embeddings; results render with similarity scores. (Currently against the mock contract; same UI binds to the real endpoint.)
- **CockroachDB as agent memory (C3):** the review flow writes corrections that surface in the "agent has learned" panel with apply-counts; the approval toast makes the learning loop visible in the moment.
- **Managed MCP Server (B4):** the Assistant page is the human surface for agent answers produced via read-only MCP queries; citations chips show the figures the agent pulled.
- **Session persistence (C2):** home page "pick up where you left off" card renders the volunteer's persisted review session; Assistant carries follow-up context.
- **Audit trail (C4/§6):** the Activity page is a filterable consumer of audit_log (human vs agent actions).
