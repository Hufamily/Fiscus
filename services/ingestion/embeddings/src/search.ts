// B3: semantic form/transaction search.
// Mock: ranks by real L2 distance against stored fixture embeddings.
// Real: uses CockroachDB's <-> (vector_l2_ops) distance operator.
//
// `searchSimilarTransactions` / `searchSimilarTemplates` are the reusable,
// API-shaped entry points — services/api (issue #26) imports these directly
// rather than the CLI-only `runSearch` below.

import { embed } from '../../../../lib/embeddings';
import { searchTransactions, searchTemplates } from './client';
import type { SearchResult, TemplateSearchResult } from './types';

/** Given a free-text query, return the top-k most similar transactions. */
export async function searchSimilarTransactions(query: string, k = 5): Promise<SearchResult[]> {
  const queryEmbedding = await embed(query);
  return searchTransactions(queryEmbedding, k);
}

/**
 * Given a new document's embedding, return the top-k matching templates
 * ranked by similarity — "which template does this look like?" (B3 spec).
 */
export async function searchSimilarTemplates(
  queryEmbedding: number[],
  k = 5,
): Promise<TemplateSearchResult[]> {
  return searchTemplates(queryEmbedding, k);
}

/** Same as searchSimilarTemplates, but takes free text instead of a precomputed embedding. */
export async function searchTemplatesByText(query: string, k = 5): Promise<TemplateSearchResult[]> {
  const queryEmbedding = await embed(query);
  return searchTemplates(queryEmbedding, k);
}

export async function runSearch(query: string, limit = 5): Promise<void> {
  const results = await searchSimilarTransactions(query, limit);

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
