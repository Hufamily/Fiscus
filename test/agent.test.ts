import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logAction } = vi.hoisted(() => ({ logAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/audit', () => ({ logAction }));

const { getAggregates, getSimilarTransactions, getSession, upsertSession } = vi.hoisted(() => ({
  getAggregates: vi.fn().mockResolvedValue([
    { category: 'veterinary', status: 'approved', total_cents: 24469, count: 1 },
  ]),
  getSimilarTransactions: vi.fn().mockResolvedValue([
    { category: 'veterinary', amount_cents: 24469, txn_date: '2024-07-15', status: 'approved' },
  ]),
  getSession: vi.fn().mockResolvedValue(null),
  upsertSession: vi.fn().mockResolvedValue({
    id: 'sess-1',
    org_id: 'org-1',
    volunteer_id: 'vol-1',
    pending_documents: {},
    current_index: 0,
    updated_at: new Date().toISOString(),
  }),
}));
vi.mock('../services/agent/src/client', () => ({
  IS_MOCK: true,
  ORG_ID: 'org-1',
  VOLUNTEER_ID: 'vol-1',
  invokeModel: vi.fn(),
  getAggregates,
  getSimilarTransactions,
  getSession,
  upsertSession,
}));

import { ask } from '../services/agent/src/agent';

beforeEach(() => {
  logAction.mockClear();
  getSession.mockClear();
  upsertSession.mockClear();
  getAggregates.mockClear();
  getSimilarTransactions.mockClear();
});

describe('ask() — RAG pipeline integration (mock mode)', () => {
  it('retrieves aggregates + similar transactions before answering', async () => {
    await ask('What did we spend on vet care?');
    expect(getAggregates).toHaveBeenCalledTimes(1);
    expect(getSimilarTransactions).toHaveBeenCalledTimes(1);
  });

  it('answers deterministically from mock data and cites a category', async () => {
    const resp = await ask('How much have we spent in total?');
    expect(resp.answer).toMatch(/656\.27/);
    expect(resp.citations.length).toBeGreaterThan(0);
    expect(resp.citations[0]).toHaveProperty('category');
  });

  it('falls back to the "no information" answer for unmatched questions', async () => {
    const resp = await ask('What is the capital of France?');
    expect(resp.answer).toBe("I don't have that information.");
    expect(resp.citations).toEqual([]);
  });

  it('persists the turn to the session and returns without a prior session when none is given', async () => {
    const resp = await ask('Any pending transactions?');
    expect(getSession).not.toHaveBeenCalled();
    expect(upsertSession).toHaveBeenCalledWith(undefined, {
      conversation: [{ question: 'Any pending transactions?', answer: expect.any(String) }],
    });
    expect(resp.session_id).toBe('sess-1');
  });

  it('loads prior conversation turns when a sessionId is supplied', async () => {
    getSession.mockResolvedValueOnce({
      id: 'sess-1',
      org_id: 'org-1',
      volunteer_id: 'vol-1',
      pending_documents: { conversation: [{ question: 'first?', answer: 'first answer' }] },
      current_index: 0,
      updated_at: new Date().toISOString(),
    });

    await ask('second question', 'sess-1');

    expect(getSession).toHaveBeenCalledWith('sess-1');
    expect(upsertSession).toHaveBeenCalledWith('sess-1', {
      conversation: [
        { question: 'first?', answer: 'first answer' },
        { question: 'second question', answer: expect.any(String) },
      ],
    });
  });

  it('audits every answered question against the session id it produced', async () => {
    const resp = await ask('vet spending?');
    expect(logAction).toHaveBeenCalledWith('org-1', 'vol-1', 'agent_answered', 'sessions', resp.session_id, {
      question: 'vet spending?',
    });
  });
});
