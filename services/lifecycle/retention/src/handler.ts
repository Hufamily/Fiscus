// Lambda entry point (EventBridge scheduled trigger, see template.yaml).
// Same "must not silently no-op in mock mode" guard as s3-extraction's
// handler.ts -- a deployed invocation always has COCKROACH_DATABASE_URL and
// real AWS credentials; IS_MOCK here would mean a misconfigured Lambda that
// looks like it ran but purged nothing.

import { IS_MOCK } from './client';
import { purgeExpiredDocuments } from './purge';

export async function handler(): Promise<void> {
  if (IS_MOCK) {
    throw new Error('Missing required environment variable: COCKROACH_DATABASE_URL (or no AWS credentials configured)');
  }
  const results = await purgeExpiredDocuments();
  console.log(`Retention purge: ${results.length} document(s) purged.`);
  for (const r of results) {
    console.log(`  - org=${r.orgId} document=${r.documentId} s3Key=${r.s3Key} retentionYears=${r.retentionYears}`);
  }
}
