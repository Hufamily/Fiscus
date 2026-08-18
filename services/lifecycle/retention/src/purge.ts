// purgeExpiredDocuments(): the D3 retention job.
//
// For each org: compute the retention cutoff from retention_years, find
// documents rows past that cutoff that still have a raw file present
// (status != 'purged'), delete the S3 object, mark the row purged, and
// audit-log the purge. Never touches `transactions` -- D2's aggregate
// reporting reads only transactions.category/status/amount_cents (see
// services/api/summaries/src/client.ts's getAggregates()), so a purge here
// cannot affect it.

import { logAction } from '../../../../lib/audit';
import {
  DEFAULT_RETENTION_YEARS,
  INGESTION_BUCKET,
  SYSTEM_ACTOR,
  deleteS3Object,
  fetchOrganizations,
  fetchPurgeCandidates,
  markDocumentPurged,
} from './client';
import type { PurgeResult } from './types';

// UTC-based so "years" means calendar years regardless of local TZ --
// matches how CockroachDB's `created_at < $cutoff` comparison will read it.
export function computeCutoff(retentionYears: number, now: Date = new Date()): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - retentionYears);
  return cutoff;
}

export async function purgeExpiredDocuments(now: Date = new Date()): Promise<PurgeResult[]> {
  const results: PurgeResult[] = [];
  const orgs = await fetchOrganizations();

  for (const org of orgs) {
    const retentionYears = org.retention_years ?? DEFAULT_RETENTION_YEARS;
    const cutoff = computeCutoff(retentionYears, now);
    const cutoffIso = cutoff.toISOString();
    const candidates = await fetchPurgeCandidates(org.id, cutoffIso);

    for (const doc of candidates) {
      await deleteS3Object(INGESTION_BUCKET, doc.s3_key);
      await markDocumentPurged(doc.id, org.id);
      await logAction(org.id, SYSTEM_ACTOR, 'document_purged', 'documents', doc.id, {
        s3Key: doc.s3_key,
        retentionYears,
        cutoff: cutoffIso,
      });
      results.push({ orgId: org.id, documentId: doc.id, s3Key: doc.s3_key, retentionYears, cutoff: cutoffIso });
    }
  }

  return results;
}
