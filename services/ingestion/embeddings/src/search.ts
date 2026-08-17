// Vector similarity search over transactions.
// Mock: returns stored rows in insertion order with synthetic distances.
// Real: uses CockroachDB's <-> cosine distance operator.

import { embed } from '../../../../lib/embeddings';
import { searchTransactions } from './client';

export async function runSearch(query: string, limit = 5): Promise<void> {
  const queryEmbedding = await embed(query);
  const results = await searchTransactions(queryEmbedding, limit);

  if (results.length === 0) {
    console.log('No transactions found. Run embed:file first to populate the database.');
    return;
  }

  console.log(`\nSearch results for: "${query}"\n`);
  console.log('Rank  Distance  Category          Amount        Date');
  console.log('----  --------  ----------------  ------------  ----------');

  results.forEach((r, i) => {
    const amount = `$${(r.amount_cents / 100).toFixed(2)}`.padStart(12);
    const cat = r.category.padEnd(16);
    console.log(`  ${(i + 1).toString().padStart(2)}  ${r.distance.toFixed(4).padStart(8)}  ${cat}  ${amount}  ${r.txn_date}`);
  });
}
