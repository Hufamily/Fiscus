// Companion to test/agent-mcp.test.ts: proves agent.ts's ask() actually
// routes "what does X table look like" questions through the MCP
// describeTable() capability instead of the existing Bedrock RAG path, and
// that unrelated questions are unaffected. Mirrors the vi.mock('.../client')
// pattern from test/summaries.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logAction } = vi.hoisted(() => ({ logAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/audit', () => ({ logAction }));

const clientMocks = vi.hoisted(() => ({
  IS_MOCK: true,
  ORG_ID: 'org-1',
  VOLUNTEER_ID: 'cli-volunteer',
  invokeModel: vi.fn().mockRejectedValue(new Error('invokeModel should not be called for a schema question')),
  getAggregates: vi.fn().mockRejectedValue(new Error('getAggregates should not be called for a schema question')),
  getSimilarTransactions: vi
    .fn()
    .mockRejectedValue(new Error('getSimilarTransactions should not be called for a schema question')),
  getSession: vi.fn().mockResolvedValue(null),
  upsertSession: vi.fn().mockImplementation(async (sessionId: string | undefined, pendingDocuments: unknown) => ({
    id: sessionId ?? 'session-1',
    org_id: 'org-1',
    volunteer_id: 'cli-volunteer',
    pending_documents: pendingDocuments,
    current_index: 0,
    updated_at: new Date().toISOString(),
  })),
}));
vi.mock('../services/agent/src/client', () => clientMocks);

const mcpMocks = vi.hoisted(() => ({
  IS_MCP_MOCK: true,
  findMentionedTable: vi.fn(),
  describeTable: vi.fn(),
}));
vi.mock('../services/agent/src/mcp-schema', () => mcpMocks);

import { ask } from '../services/agent/src/agent';

beforeEach(() => {
  logAction.mockClear();
  clientMocks.invokeModel.mockClear();
  clientMocks.getAggregates.mockClear();
  clientMocks.getSimilarTransactions.mockClear();
  clientMocks.getSession.mockClear();
  clientMocks.upsertSession.mockClear();
  mcpMocks.findMentionedTable.mockReset();
  mcpMocks.describeTable.mockReset();
});

describe('agent.ask() — schema questions route through MCP, not Bedrock RAG', () => {
  it('answers "what does the transactions table look like" via describeTable(), bypassing aggregates/Bedrock', async () => {
    mcpMocks.findMentionedTable.mockResolvedValue('transactions');
    mcpMocks.describeTable.mockResolvedValue(
      'Schema for "transactions" (via CockroachDB Managed MCP Server, read-only):\nCREATE TABLE public.transactions (...)',
    );

    const response = await ask('what does the transactions table look like?');

    expect(response.answer).toContain('CockroachDB Managed MCP Server');
    expect(response.answer).toContain('CREATE TABLE public.transactions');
    expect(response.citations).toEqual([
      { category: 'transactions', detail: expect.stringContaining('get_table_schema(transactions)') },
    ]);

    expect(mcpMocks.findMentionedTable).toHaveBeenCalledWith('what does the transactions table look like?');
    expect(mcpMocks.describeTable).toHaveBeenCalledWith('transactions');
    expect(clientMocks.invokeModel).not.toHaveBeenCalled();
    expect(clientMocks.getAggregates).not.toHaveBeenCalled();
    expect(clientMocks.getSimilarTransactions).not.toHaveBeenCalled();

    expect(logAction).toHaveBeenCalledWith(
      'org-1',
      'cli-volunteer',
      'agent_answered_schema',
      'sessions',
      'session-1',
      { question: 'what does the transactions table look like?', table: 'transactions', mcp_mock: true },
    );
  });

  it('falls back to the normal aggregate/RAG path when no table is mentioned', async () => {
    mcpMocks.findMentionedTable.mockResolvedValue(null);
    clientMocks.getAggregates.mockResolvedValueOnce([]);
    clientMocks.getSimilarTransactions.mockResolvedValueOnce([]);

    const response = await ask('what is the schema of the budget for next year?');

    // Not routed through MCP -- falls through to the existing RAG path.
    expect(mcpMocks.describeTable).not.toHaveBeenCalled();
    expect(clientMocks.getAggregates).toHaveBeenCalled();
    expect(response.session_id).toBe('session-1');
  });

  it('leaves ordinary (non-schema) questions on the existing RAG path entirely', async () => {
    clientMocks.getAggregates.mockResolvedValueOnce([]);
    clientMocks.getSimilarTransactions.mockResolvedValueOnce([]);

    await ask('how much did we spend on vet bills?');

    expect(mcpMocks.findMentionedTable).not.toHaveBeenCalled();
    expect(mcpMocks.describeTable).not.toHaveBeenCalled();
    expect(clientMocks.getAggregates).toHaveBeenCalled();
  });
});
