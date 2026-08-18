// CLI for local testing without a deployed Lambda/EventBridge schedule --
// runs the same purgeExpiredDocuments() path the scheduled handler does,
// against mock-db.json when no DATABASE_URL/AWS credentials are set.

import { IS_MOCK } from './client';
import { purgeExpiredDocuments } from './purge';

async function main(): Promise<void> {
  const mode = IS_MOCK ? '[mock mode]' : '[real mode]';
  console.log(`${mode} Running retention purge...`);
  const results = await purgeExpiredDocuments();
  if (results.length === 0) {
    console.log(`${mode} No documents past retention.`);
    return;
  }
  console.log(`${mode} Purged ${results.length} document(s):`);
  for (const r of results) {
    console.log(`  - org=${r.orgId} document=${r.documentId} s3Key=${r.s3Key} retentionYears=${r.retentionYears} cutoff=${r.cutoff}`);
  }
}

void main().catch((err: Error) => {
  console.error('Error:', err.message);
  process.exit(1);
});
