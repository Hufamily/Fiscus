# Tool usage log

Add one row every time a merged PR is the first to exercise a given tool.
This becomes the basis for the submission's "which tools did you use and
how" writeup — keep it accurate as you go, don't reconstruct it at the end.

## Required tools

| Category | Tool | Used? | How (fill in as implemented) | First PR |
|---|---|---|---|---|
| CockroachDB | Distributed Vector Indexing | ☑ | B1 embeddings: transactions.embedding VECTOR(1536) stores Titan embeddings; search.ts uses <-> cosine distance operator for similarity ranking | B1 |
| CockroachDB | Managed MCP Server | ☐ | | |
| CockroachDB | Agent Skills Repo | ☐ | | |
| AWS | S3 | ☐ | | |
| AWS | Lambda | ☐ | | |
| AWS | Bedrock | ☑ | B2 template-gen: Claude 3.5 Haiku infers schema_json from 2+ example docs; Titan Embed Text v2 (1536 dims) computes the template embedding stored in CockroachDB | B2 |

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
