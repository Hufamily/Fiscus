import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AggregateRow, SessionRow, TransactionSummary } from '../services/agent/src/types';

// services/agent/src/agent.ts imports lib/embeddings.embed() and lib/redact.redact()
// for real (not mocked) — that's the point: this file checks the agent actually
// redacts before anything would reach Bedrock, per AGENTS.md §5 rule #1. Only the
// DB/Bedrock boundary (./client) and the audit sink are mocked per-test below.
vi.mock('../lib/audit', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }));

const nowIso = () => new Date().toISOString();

function mockClient(overrides: {
  isMock: boolean;
  invokeModel?: ReturnType<typeof vi.fn>;
  aggregates?: AggregateRow[];
  similar?: TransactionSummary[];
  session?: SessionRow | null;
}) {
  const upsertSession = vi.fn().mockImplementation(
    async (sessionId: string | undefined, pending: SessionRow['pending_documents']): Promise<SessionRow> => ({
      id: sessionId ?? 'sess-new',
      org_id: 'org-1',
      volunteer_id: 'vol-1',
      pending_documents: pending,
      current_index: 0,
      updated_at: nowIso(),
    }),
  );
  vi.doMock('../services/agent/src/client', () => ({
    IS_MOCK: overrides.isMock,
    ORG_ID: 'org-1',
    VOLUNTEER_ID: 'vol-1',
    invokeModel: overrides.invokeModel ?? vi.fn(),
    getAggregates: vi.fn().mockResolvedValue(overrides.aggregates ?? []),
    getSimilarTransactions: vi.fn().mockResolvedValue(overrides.similar ?? []),
    getSession: vi.fn().mockResolvedValue(overrides.session ?? null),
    upsertSession,
  }));
  return { upsertSession };
}

beforeEach(() => {
  vi.resetModules();
});

describe('ask — mock mode (IS_MOCK=true): deterministic keyword answers', () => {
  it('answers a "total" question from the canned mock branch and persists the session', async () => {
    const { upsertSession } = mockClient({ isMock: true });
    const { ask } = await import('../services/agent/src/agent');
    const { logAction } = await import('../lib/audit');

    const resp = await ask('What was our total spend this year?');

    expect(resp.answer).toContain('656.27');
    expect(resp.citations.length).toBeGreaterThan(0);
    expect(resp.session_id).toBe('sess-new');
    expect(upsertSession).toHaveBeenCalledWith(undefined, {
      conversation: [{ question: 'What was our total spend this year?', answer: resp.answer }],
    });
    expect(logAction).toHaveBeenCalledWith('org-1', 'vol-1', 'agent_answered', 'sessions', 'sess-new', {
      question: 'What was our total spend this year?',
    });
  });

  it('falls back to "I don\'t have that information" for an unrecognized question', async () => {
    mockClient({ isMock: true });
    const { ask } = await import('../services/agent/src/agent');

    const resp = await ask('what is the weather today');

    expect(resp.answer).toBe("I don't have that information.");
    expect(resp.citations).toEqual([]);
  });
});

describe('ask — real mode (IS_MOCK=false): redaction and Claude response parsing', () => {
  it('never forwards a raw Luhn-valid card number from prior conversation to invokeModel', async () => {
    const invokeModel = vi.fn().mockResolvedValue(JSON.stringify({ answer: 'ok', citations: [] }));
    mockClient({
      isMock: false,
      invokeModel,
      session: {
        id: 'sess-2',
        org_id: 'org-1',
        volunteer_id: 'vol-1',
        pending_documents: {
          conversation: [{ question: 'what card was used', answer: 'Card on file: 4111 1111 1111 1111' }],
        },
        current_index: 0,
        updated_at: nowIso(),
      },
    });
    const { ask } = await import('../services/agent/src/agent');

    await ask('and now?', 'sess-2');

    expect(invokeModel).toHaveBeenCalledTimes(1);
    const [, userPrompt] = invokeModel.mock.calls[0] as [string, string];
    expect(userPrompt).not.toContain('4111 1111 1111 1111');
    expect(userPrompt).not.toContain('4111111111111111');
    // redact.ts keeps the last 4 digits — confirms redaction ran rather than the field vanishing.
    expect(userPrompt).toContain('1111');
  });

  it('parses a well-formed Claude JSON reply into answer + citations', async () => {
    const invokeModel = vi.fn().mockResolvedValue(
      'Sure, here you go:\n' + JSON.stringify({
        answer: 'Veterinary spend is $568.77.',
        citations: [{ category: 'veterinary', detail: 'total: $568.77' }],
      }),
    );
    mockClient({ isMock: false, invokeModel });
    const { ask } = await import('../services/agent/src/agent');

    const resp = await ask('how much on vet bills?');

    expect(resp.answer).toBe('Veterinary spend is $568.77.');
    expect(resp.citations).toEqual([{ category: 'veterinary', detail: 'total: $568.77' }]);
  });

  it('throws when Claude does not return JSON at all', async () => {
    const invokeModel = vi.fn().mockResolvedValue('I cannot help with that.');
    mockClient({ isMock: false, invokeModel });
    const { ask } = await import('../services/agent/src/agent');

    await expect(ask('anything')).rejects.toThrow(/not JSON/);
  });
});
