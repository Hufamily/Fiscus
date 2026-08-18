// Tests for issue #9 (B4): MCP-based schema introspection wired into the
// volunteer agent, read-only only.
//
// This file exercises services/agent/src/mcp-schema.ts directly, against
// its real MockIntrospector (no COCKROACH_MCP_API_KEY is set in test env,
// so getSchemaIntrospector() picks the fixture-backed implementation --
// nothing here is mocked). The fixture (fixtures/mock-mcp-schema.json) was
// captured verbatim from a live get_table_schema/list_tables call against
// the shared dev cluster -- see docs/tool-usage.md.
//
// See test/agent-mcp-routing.test.ts for the agent.ts integration tests,
// which mock mcp-schema.ts out and therefore have to live in a separate
// file: vi.mock() hoists to the top of the whole module, so mixing a
// "real module" suite and a "mocked module" suite for the same import path
// in one file would make the mock leak into these tests.

import { describe, it, expect } from 'vitest';
import { getSchemaIntrospector, findMentionedTable, describeTable } from '../services/agent/src/mcp-schema';

describe('mcp-schema — read-only MCP schema introspection (real MockIntrospector)', () => {
  it('discovers table names dynamically via listTables(), not a hardcoded list', async () => {
    const tables = await getSchemaIntrospector().listTables();
    const names = tables.map((t) => t.table_name);
    expect(names).toEqual(
      expect.arrayContaining(['transactions', 'documents', 'organizations', 'volunteers', 'sessions']),
    );
  });

  it('resolves a table mentioned in a free-text question by checking the live catalog', async () => {
    expect(await findMentionedTable('what does the transactions table look like')).toBe('transactions');
    expect(await findMentionedTable('schema of documents')).toBe('documents');
  });

  it('returns null for a table that does not exist in the catalog, rather than guessing', async () => {
    expect(await findMentionedTable('what does the frobnicator table look like')).toBeNull();
  });

  it('describeTable() returns the real CREATE TABLE statement via get_table_schema', async () => {
    const answer = await describeTable('transactions');
    expect(answer).toContain('Managed MCP Server');
    expect(answer).toContain('CREATE TABLE public.transactions');
    expect(answer).toContain('amount_cents INT8 NOT NULL');
  });

  it('rejects a non-SELECT statement client-side before it would reach the network', async () => {
    const introspector = getSchemaIntrospector();
    await expect(introspector.selectQuery('DELETE FROM transactions WHERE 1=1')).rejects.toThrow(/read-only/i);
    await expect(
      introspector.selectQuery("INSERT INTO organizations (id, name) VALUES (1, 'x')"),
    ).rejects.toThrow(/read-only/i);
    // A real SELECT is allowed through (mock returns an empty result set,
    // but critically does not throw).
    await expect(introspector.selectQuery('SELECT 1')).resolves.toEqual([]);
  });

  it('the read-only surface has no write/insert/update/delete method at all', () => {
    const introspector = getSchemaIntrospector() as unknown as Record<string, unknown>;
    for (const method of ['insertRows', 'insert', 'update', 'delete', 'createTable', 'createDatabase', 'write']) {
      expect(introspector[method]).toBeUndefined();
    }
  });
});
