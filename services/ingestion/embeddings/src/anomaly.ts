// B3: anomaly flagging.
//
// A transaction is "anomalous" when its k nearest neighbors (by embedding
// distance, excluding itself) are ALL below a similarity threshold — i.e. it
// doesn't resemble anything else this org has recorded. Flagged transactions
// get `status = review_flagged` (see db/migrations/006_b3_review_flagged.sql)
// so a human reviewer sees them, instead of silently sitting in
// `pending_review` alongside routine transactions.
//
// Every flag is audit-logged via lib/audit.ts per AGENTS.md §5.4/§6 — no
// exceptions for agent-driven writes.

import { logAction } from '../../../../lib/audit';
import { searchTransactions, updateTransactionStatus, ORG_ID, type SearchOpts } from './client';
import type { SearchResult } from './types';

export const DEFAULT_ANOMALY_K = 3;
// Mock-mode embeddings (lib/embeddings.ts `mockEmbed`) are deterministic
// hash-based floats, not real semantic vectors: identical extraction text
// collapses to distance 0, and anything else lands around ~15-16 in this
// 1536-dim space. A mid-range threshold cleanly separates "known duplicate/
// near-duplicate" from "unlike anything on file" in both mock and real mode
// (Titan embeddings are normalized, so genuinely similar real documents sit
// well under this too).
export const DEFAULT_DISTANCE_THRESHOLD = 8;

export interface AnomalyCheckResult {
  flagged: boolean;
  neighbors: SearchResult[];
}

export interface AnomalyCheckOpts {
  k?: number;
  distanceThreshold?: number;
  actorId?: string;
  orgId?: string;
}

/**
 * Look up a transaction's nearest neighbors and flag it `review_flagged` if
 * every one of them is below the similarity threshold (i.e. distance above
 * `distanceThreshold`). No-op (not flagged) when there are no other
 * transactions to compare against yet — that's "no data," not "anomalous."
 *
 * Reusable entry point: services/api (issue #26) can import this directly
 * and call it after inserting a transaction, without depending on the CLI.
 */
export async function checkAndFlagAnomaly(
  transactionId: string,
  queryEmbedding: number[],
  opts: AnomalyCheckOpts = {},
): Promise<AnomalyCheckResult> {
  const k = opts.k ?? DEFAULT_ANOMALY_K;
  const distanceThreshold = opts.distanceThreshold ?? DEFAULT_DISTANCE_THRESHOLD;
  const orgId = opts.orgId ?? ORG_ID;
  const actorId = opts.actorId ?? 'cli-system';

  const searchOpts: SearchOpts = { excludeId: transactionId };
  const neighbors = await searchTransactions(queryEmbedding, k, searchOpts);

  const flagged = neighbors.length > 0 && neighbors.every((n) => n.distance > distanceThreshold);

  if (flagged) {
    await updateTransactionStatus(transactionId, 'review_flagged');
    await logAction(orgId, actorId, 'anomaly_flagged', 'transactions', transactionId, {
      k,
      distance_threshold: distanceThreshold,
      neighbor_ids: neighbors.map((n) => n.id),
      neighbor_distances: neighbors.map((n) => n.distance),
    });
  }

  return { flagged, neighbors };
}
