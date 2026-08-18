// B3: anomaly flagging — unit tests against a mocked client/audit, mirroring
// the vi.mock('.../client') pattern from test/summaries.test.ts.
//
// checkAndFlagAnomaly writes (transaction status + audit log), so unlike
// test/search.test.ts's read-only fixture reads, this mocks the client
// module rather than hitting the real fixtures/mock-db.json — a test suite
// shouldn't leave the working tree dirty (see CLAUDE.md Learnings).

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

import { checkAndFlagAnomaly, DEFAULT_ANOMALY_K, DEFAULT_DISTANCE_THRESHOLD } from '../services/ingestion/embeddings/src/anomaly';

beforeEach(() => {
  logAction.mockClear();
  searchTransactions.mockClear();
  updateTransactionStatus.mockClear();
});

const farNeighbor = (id: string, distance: number) => ({
  id, category: 'unclassified', amount_cents: 1, txn_date: '2019-01-01', distance,
});

describe('checkAndFlagAnomaly — intentionally weird seed transaction', () => {
  it('flags review_flagged and audits when every neighbor is below the similarity threshold', async () => {
    searchTransactions.mockResolvedValue([
      farNeighbor('n1', DEFAULT_DISTANCE_THRESHOLD + 5),
      farNeighbor('n2', DEFAULT_DISTANCE_THRESHOLD + 8),
      farNeighbor('n3', DEFAULT_DISTANCE_THRESHOLD + 1),
    ]);

    const result = await checkAndFlagAnomaly('weird-txn-1', [0.1, 0.2, 0.3], { orgId: 'org-1', actorId: 'cli-system' });

    expect(result.flagged).toBe(true);
    expect(searchTransactions).toHaveBeenCalledWith(
      [0.1, 0.2, 0.3],
      DEFAULT_ANOMALY_K,
      { excludeId: 'weird-txn-1' },
    );
    expect(updateTransactionStatus).toHaveBeenCalledWith('weird-txn-1', 'review_flagged');
    expect(logAction).toHaveBeenCalledWith(
      'org-1', 'cli-system', 'anomaly_flagged', 'transactions', 'weird-txn-1',
      expect.objectContaining({
        k: DEFAULT_ANOMALY_K,
        distance_threshold: DEFAULT_DISTANCE_THRESHOLD,
        neighbor_ids: ['n1', 'n2', 'n3'],
      }),
    );
  });

  it('does not flag when at least one neighbor is similar enough', async () => {
    searchTransactions.mockResolvedValue([
      farNeighbor('close', 0), // near-duplicate
      farNeighbor('far', DEFAULT_DISTANCE_THRESHOLD + 5),
    ]);

    const result = await checkAndFlagAnomaly('normal-txn-1', [0.1, 0.2, 0.3]);

    expect(result.flagged).toBe(false);
    expect(updateTransactionStatus).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it('does not flag when there are no other transactions to compare against (no data, not anomalous)', async () => {
    searchTransactions.mockResolvedValue([]);

    const result = await checkAndFlagAnomaly('first-ever-txn', [0.1, 0.2, 0.3]);

    expect(result.flagged).toBe(false);
    expect(updateTransactionStatus).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it('respects a caller-supplied k and distanceThreshold', async () => {
    searchTransactions.mockResolvedValue([farNeighbor('n1', 3)]);

    const result = await checkAndFlagAnomaly('txn-1', [0.1], { k: 1, distanceThreshold: 2 });

    expect(searchTransactions).toHaveBeenCalledWith([0.1], 1, { excludeId: 'txn-1' });
    expect(result.flagged).toBe(true); // distance 3 > threshold 2
  });
});
