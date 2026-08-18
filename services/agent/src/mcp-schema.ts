// Read-only CockroachDB schema introspection via the CockroachDB Cloud
// Managed MCP Server (https://cockroachlabs.cloud/mcp), for issue #9 (B4).
//
// AGENTS.md §6: "the agent talks to CockroachDB through the Managed MCP
// Server in read-only mode by default. Any write path goes through our own
// service layer (not raw MCP writes) so audit logging and redaction can't
// be bypassed." This module is that read-only surface for the agent:
//
//   - listTables()          -> table names, dynamically, from the live catalog
//   - getTableSchema(table) -> a table's CREATE TABLE statement
//   - selectQuery(sql)      -> aggregate-shaped read queries
//
// There is deliberately NO insert/update/delete method anywhere in this
// file. That is not an oversight to fill in later -- see
// docs/tool-usage.md ("Write boundary") for how this was verified against
// a live MCP connection: the `select_query` tool itself refuses any
// non-SELECT statement server-side, and this client adds the same check
// again before the request ever leaves the process (defense in depth).
// Existing writes (extraction results, corrections, summaries) continue to
// go through lib/audit.ts + the normal `pg` pool in client.ts, untouched.
//
// Two implementations:
//   - RemoteMcpIntrospector: real @modelcontextprotocol/sdk client over
//     StreamableHTTP, talking to the URL from the Cloud Console config
//     snippet. Only *connected* lazily, on first call, and only when
//     COCKROACH_MCP_API_KEY is set (see getSchemaIntrospector below).
//   - MockIntrospector: fixtures/mock-mcp-schema.json, captured verbatim
//     from a live call against the shared dev cluster. Used whenever no
//     MCP credentials are configured (this sandbox included -- see
//     docs/tool-usage.md for what was and wasn't exercised against a real
//     network connection here).
//
// Swapping one for the other is exactly the point of the SchemaIntrospector
// interface: agent.ts only depends on that interface, never on which
// implementation is behind it.

import { readFileSync } from 'fs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { MODULE_ROOT } from './client';

export interface McpTableInfo {
  schema_name: string;
  table_name: string;
  type: string;
}

export interface McpTableSchema {
  table_name: string;
  create_statement: string;
}

/**
 * The read-only surface this module exposes to the rest of the agent.
 * Intentionally has no write/insert/update/delete method -- see the file
 * header and docs/tool-usage.md.
 */
export interface SchemaIntrospector {
  listTables(): Promise<McpTableInfo[]>;
  getTableSchema(table: string): Promise<McpTableSchema>;
  selectQuery(query: string): Promise<Record<string, unknown>[]>;
}

const MCP_URL = process.env.COCKROACH_MCP_URL ?? 'https://cockroachlabs.cloud/mcp';
const MCP_API_KEY = process.env.COCKROACH_MCP_API_KEY;
const MCP_CLUSTER_ID = process.env.COCKROACH_MCP_CLUSTER_ID;
const MCP_DATABASE = process.env.COCKROACH_MCP_DATABASE ?? 'defaultdb';

/** True whenever no live MCP credentials are configured -- mirrors the
 * IS_MOCK pattern in ./client.ts, but scoped to the MCP transport only, so
 * the agent can run in "real DB + mock MCP" or "mock DB + real MCP" too. */
export const IS_MCP_MOCK = !MCP_API_KEY;

function assertReadOnly(query: string): void {
  const trimmed = query.trim().replace(/;+\s*$/, '');
  if (!/^select\b/i.test(trimmed)) {
    throw new Error(
      `Refused to send a non-SELECT statement through the read-only MCP schema client: "${trimmed.slice(0, 80)}"`,
    );
  }
}

// ── Real transport: CockroachDB Cloud Managed MCP Server ───────────────────
// Mirrors the Cloud Console config snippet at https://cockroachlabs.cloud/mcp
// (StreamableHTTP transport, bearer auth). Tool names/argument shapes below
// (`list_tables`, `get_table_schema`, `select_query`, each taking
// `{database, ...}` and optionally `cluster_id`) were verified directly
// against a live connection to the same Managed MCP Server during this
// issue -- see docs/tool-usage.md for the transcript.
class RemoteMcpIntrospector implements SchemaIntrospector {
  private clientPromise: Promise<Client> | null = null;

  private async getClient(): Promise<Client> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
          requestInit: { headers: { Authorization: `Bearer ${MCP_API_KEY}` } },
        });
        const client = new Client({ name: 'fiscus-agent', version: '0.1.0' });
        await client.connect(transport);
        return client;
      })();
    }
    return this.clientPromise;
  }

  private async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const client = await this.getClient();
    const result = await client.callTool({
      name,
      arguments: MCP_CLUSTER_ID ? { ...args, cluster_id: MCP_CLUSTER_ID } : args,
    });
    if (result.isError) {
      throw new Error(`MCP tool "${name}" returned an error: ${JSON.stringify(result.content)}`);
    }
    const content = result.content;
    const first = Array.isArray(content) ? content[0] : undefined;
    const text = first && first.type === 'text' ? first.text : undefined;
    if (typeof text !== 'string') {
      throw new Error(`MCP tool "${name}" returned no text content`);
    }
    return JSON.parse(text) as T;
  }

  async listTables(): Promise<McpTableInfo[]> {
    const { rows } = await this.callTool<{ rows: McpTableInfo[] }>('list_tables', { database: MCP_DATABASE });
    return rows;
  }

  async getTableSchema(table: string): Promise<McpTableSchema> {
    const { rows } = await this.callTool<{ rows: McpTableSchema[] }>('get_table_schema', {
      database: MCP_DATABASE,
      table,
    });
    const schema = rows[0];
    if (!schema) throw new Error(`MCP returned no schema for table "${table}"`);
    return schema;
  }

  async selectQuery(query: string): Promise<Record<string, unknown>[]> {
    assertReadOnly(query);
    const { rows } = await this.callTool<{ rows: Record<string, unknown>[] }>('select_query', {
      database: MCP_DATABASE,
      query,
    });
    return rows;
  }
}

// ── Mock transport: fixtures/mock-mcp-schema.json ───────────────────────────
// Not invented data -- captured from a real get_table_schema/list_tables
// round trip against the shared dev cluster. Stands in for the network call
// exactly the way fixtures/mock-db.json stands in for `pg` in client.ts.
interface MockFixture {
  tables: McpTableInfo[];
  schemas: Record<string, string>;
}

const MOCK_MCP_PATH = path.resolve(MODULE_ROOT, 'fixtures', 'mock-mcp-schema.json');

function readFixture(): MockFixture {
  return JSON.parse(readFileSync(MOCK_MCP_PATH, 'utf-8')) as MockFixture;
}

class MockIntrospector implements SchemaIntrospector {
  async listTables(): Promise<McpTableInfo[]> {
    return readFixture().tables;
  }

  async getTableSchema(table: string): Promise<McpTableSchema> {
    const fixture = readFixture();
    const createStatement = fixture.schemas[table];
    if (!createStatement) {
      throw new Error(`MCP (mock) returned no schema for table "${table}"`);
    }
    return { table_name: `defaultdb.public.${table}`, create_statement: createStatement };
  }

  async selectQuery(query: string): Promise<Record<string, unknown>[]> {
    assertReadOnly(query);
    // The mock transport doesn't execute arbitrary SQL; it only proves the
    // read-only contract (see assertReadOnly above) and is otherwise unused
    // by describeTable(). Real aggregate/similarity reads for the Q&A flow
    // continue to go through client.ts's `pg` pool, same as before this
    // issue.
    return [];
  }
}

let _client: SchemaIntrospector | null = null;

/** Returns the configured SchemaIntrospector -- real MCP client if
 * COCKROACH_MCP_API_KEY is set, otherwise the fixture-backed mock. */
export function getSchemaIntrospector(): SchemaIntrospector {
  if (!_client) {
    _client = IS_MCP_MOCK ? new MockIntrospector() : new RemoteMcpIntrospector();
  }
  return _client;
}

const TABLE_MENTION_RE = /\b([a-z_]+)\s+table\b|\btable\s+([a-z_]+)\b|schema of ([a-z_]+)\b/i;

/**
 * Given a free-text question, finds a table name it mentions by checking
 * against the live (or mock) table catalog -- NOT a hardcoded list of known
 * tables/columns. This is what makes "what does the transactions table look
 * like" answerable without the agent process having any built-in schema
 * knowledge of its own.
 */
export async function findMentionedTable(question: string): Promise<string | null> {
  const introspector = getSchemaIntrospector();
  const tables = await introspector.listTables();
  const q = question.toLowerCase();
  for (const t of tables) {
    if (q.includes(t.table_name.toLowerCase())) return t.table_name;
  }
  const match = TABLE_MENTION_RE.exec(q);
  const candidate = match?.[1] ?? match?.[2] ?? match?.[3];
  if (candidate && tables.some((t) => t.table_name.toLowerCase() === candidate)) {
    return candidate;
  }
  return null;
}

/** Human-readable "what does X look like" answer, sourced live via MCP
 * schema introspection (or the mock fixture standing in for it). */
export async function describeTable(table: string): Promise<string> {
  const introspector = getSchemaIntrospector();
  const schema = await introspector.getTableSchema(table);
  return `Schema for "${table}" (via CockroachDB Managed MCP Server, read-only):\n${schema.create_statement}`;
}
