// C4: agent action audit trail integration — anomaly flagged. See
// test/audit-trail-integration.test.ts's file header for why this is a
// separate file from the other C4 flows (vi.mock is file-scoped; this flow
// needs the *real* services/ingestion/embeddings/src/anomaly.ts, which would
// collide with test/audit-trail-template-used.test.ts's mock of it).
//
// This duplicates a little of test/search-anomaly.test.ts's coverage
// (checkAndFlagAnomaly already has unit tests there) but is kept here too so
// all 5 C4 action types are driven from one clearly-named suite plus its
// necessary siblings, rather than scattered without a clear "this is C4's
// coverage" home.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logAction } = vi.hoisted(() => ({ logAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/audit', () => ({ logAction }));

const { searchTransactions, updateTransactionStatus } = vi.hoisted(() => ({
  searchTransactions: vi.fn(),
  updateTransactionStatus: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/ingestion/embeddings/src/client', () => ({
  searchTransactions,
  updateTransactionStatus,
  ORG_ID: 'org-1',
}));

beforeEach(() => {
  logAction.mockClear();
  searchTransactions.mockClear();
  updateTransactionStatus.mockClear();
});

describe('anomaly flagged', () => {
  it('produces exactly one anomaly_flagged row with neighbor_ids/neighbor_distances', async () => {
    const { checkAndFlagAnomaly, DEFAULT_DISTANCE_THRESHOLD } = await import('../services/ingestion/embeddings/src/anomaly.js');
    searchTransactions.mockResolvedValue([
      { id: 'n1', category: 'unclassified', amount_cents: 1, txn_date: '2019-01-01', distance: DEFAULT_DISTANCE_THRESHOLD + 5 },
    ]);

    const result = await checkAndFlagAnomaly('weird-txn', [0.1, 0.2], { orgId: 'org-1', actorId: 'cli-system' });

    expect(result.flagged).toBe(true);
    expect(updateTransactionStatus).toHaveBeenCalledWith('weird-txn', 'review_flagged');
    expect(logAction).toHaveBeenCalledTimes(1);
    const [orgId, actorId, action, targetTable, targetId, detail] = logAction.mock.calls[0];
    expect([orgId, actorId, action, targetTable, targetId]).toEqual(['org-1', 'cli-system', 'anomaly_flagged', 'transactions', 'weird-txn']);
    expect(detail).toMatchObject({ neighbor_ids: ['n1'] });
  });

  it('does not flag (and does not audit) when at least one neighbor is similar enough', async () => {
    const { checkAndFlagAnomaly } = await import('../services/ingestion/embeddings/src/anomaly.js');
    searchTransactions.mockResolvedValue([
      { id: 'close', category: 'veterinary', amount_cents: 1, txn_date: '2024-01-01', distance: 0 },
    ]);

    const result = await checkAndFlagAnomaly('normal-txn', [0.1, 0.2], { orgId: 'org-1', actorId: 'cli-system' });

    expect(result.flagged).toBe(false);
    expect(updateTransactionStatus).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });
});
