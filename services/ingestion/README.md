# Ingestion service (Track A)

S3 upload handling + Lambda extraction pipeline (A2), embeddings (B1), and
template generation (B2). See the data model in
[`AGENTS.md` §4](../../AGENTS.md).

- **A2 (S3 upload + Lambda extraction):** [`s3-extraction/`](./s3-extraction/README.md).
- **B1 (embeddings):** [`embeddings/`](./embeddings).
- **B2 (template generation):** [`template-gen/`](./template-gen).
