// Read-only CockroachDB access via the CockroachDB Cloud Managed MCP Server,
// used by the Bedrock agent instead of a raw `pg` connection.
//
// Per AGENTS.md §3/§6: "the agent talks to CockroachDB through the Managed
// MCP Server in read-only mode by default. Any write path goes through our
// own service layer (not raw MCP writes) so audit logging and redaction
// can't be bypassed." This module therefore only exposes a read path —
// writes stay on the `pg` pool in client.ts.
//
// Auth: a CockroachDB Cloud service-account API key (scoped to `mcp:read`,
// never `mcp:write`) sent as a Bearer token — the mechanism Cockroach Labs
// docs describe for "autonomous agents in pipelines" hitting the managed
// HTTPS endpoint (https://cockroachlabs.cloud/mcp), as opposed to the OAuth
// 2.1 + PKCE flow used for interactive tools. The key comes from
// COCKROACH_MCP_API_KEY (env / Secrets Manager) only — it is never logged,
// never echoed in thrown errors, and never sent to Bedrock.
//
// KNOWN GAP: the exact JSON shape `select_query` returns isn't documented
// where this was written, and this hasn't been run against a live managed
// server. parseRows() below is defensive and throws a descriptive (secret-
// free) error if the shape doesn't match either of the two documented MCP
// conventions (a raw array of rows, or `{ rows: [...] }`) — whoever wires
// up a real COCKROACH_MCP_API_KEY should verify against the live server and
// tighten this.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_URL = process.env.COCKROACH_MCP_URL ?? 'https://cockroachlabs.cloud/mcp';
const MCP_API_KEY = process.env.COCKROACH_MCP_API_KEY;

// Read-only tool names as documented for the CockroachDB MCP server. Kept as
// an explicit allowlist (rather than "whatever the server advertises") so a
// misconfigured or compromised server can't trick this client into calling
// a write-capable tool.
const READ_TOOL_CANDIDATES = ['select_query', 'query', 'run_query', 'sql_query'];

let _client: Client | null = null;
let _connecting: Promise<Client> | null = null;
let _queryToolName: string | null = null;
let _queryArgKey: string | null = null;

export function isMcpConfigured(): boolean {
  return !!MCP_API_KEY;
}

async function connect(): Promise<Client> {
  if (_client) return _client;
  if (_connecting) return _connecting;

  _connecting = (async () => {
    if (!MCP_API_KEY) {
      throw new Error('COCKROACH_MCP_API_KEY is not set; cannot connect to the Managed MCP Server');
    }
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: {
        headers: { Authorization: `Bearer ${MCP_API_KEY}` },
      },
    });
    const client = new Client({ name: 'fiscus-agent', version: '0.1.0' }, { capabilities: {} });
    await client.connect(transport);

    const { tools } = await client.listTools();
    const match = tools.find((t) => READ_TOOL_CANDIDATES.includes(t.name));
    if (!match) {
      throw new Error(
        `Managed MCP Server exposed no read-only query tool from [${READ_TOOL_CANDIDATES.join(', ')}]; ` +
          `available tools: [${tools.map((t) => t.name).join(', ')}]`,
      );
    }
    const props = match.inputSchema.properties ?? {};
    const argKey =
      ['sql', 'query', 'statement'].find((k) => k in props) ??
      Object.keys(props).find((k) => (props[k] as { type?: string }).type === 'string');
    if (!argKey) {
      throw new Error(`Could not determine the SQL argument for MCP tool "${match.name}"`);
    }

    _queryToolName = match.name;
    _queryArgKey = argKey;
    _client = client;
    return client;
  })();

  try {
    return await _connecting;
  } finally {
    _connecting = null;
  }
}

function parseRows<T>(text: string): T[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`MCP query tool returned non-JSON content (${text.length} chars) — unexpected response shape`);
  }
  if (Array.isArray(parsed)) return parsed as T[];
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { rows?: unknown }).rows)) {
    return (parsed as { rows: T[] }).rows;
  }
  throw new Error('MCP query tool returned JSON that is neither an array nor { rows: [...] }');
}

/**
 * Runs a read-only, backend-built SQL statement through the Managed MCP
 * Server's query tool. `sql` must be fully built from validated,
 * backend-controlled values (UUIDs, numbers) before it reaches here — this
 * function does not parameterize or escape, matching how MCP SQL-query
 * tools accept a single SQL string rather than bind parameters.
 */
export async function runReadOnlyQuery<T>(sql: string): Promise<T[]> {
  const client = await connect();
  const result = await client.callTool({
    name: _queryToolName!,
    arguments: { [_queryArgKey!]: sql },
  });
  if (result.isError) {
    const detail = result.content.find((c): c is { type: 'text'; text: string } => c.type === 'text')?.text;
    throw new Error(`MCP query failed: ${detail ?? 'unknown error'}`);
  }
  const textBlock = result.content.find((c): c is { type: 'text'; text: string } => c.type === 'text');
  if (!textBlock) {
    throw new Error('MCP query tool returned no text content');
  }
  return parseRows<T>(textBlock.text);
}

// ── Validation helpers ──────────────────────────────────────────────────────
// Reads flowing through MCP inline their arguments into the SQL string (see
// runReadOnlyQuery above), so every value must be strictly validated first.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, label: string): string {
  if (!UUID_RE.test(value)) {
    throw new Error(`${label} is not a valid UUID`);
  }
  return value;
}

export function assertPositiveInt(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

export function embeddingLiteral(embedding: number[], label = 'embedding'): string {
  if (!Array.isArray(embedding) || embedding.length === 0 || !embedding.every((n) => Number.isFinite(n))) {
    throw new Error(`${label} must be a non-empty array of finite numbers`);
  }
  return `[${embedding.join(',')}]`;
}
