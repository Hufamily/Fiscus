// B3: semantic search over transactions and templates.
//
// Unmocked, fixture-read pattern (like test/s3-extraction.test.ts): imports
// the embeddings module's real client/search functions directly against the
// checked-in fixtures/mock-db.json. Read-only — search never writes, so this
// is safe to run without leaving the working tree dirty.

import { describe, it, expect } from 'vitest';
import { embed } from '../lib/embeddings';
import { searchSimilarTransactions, searchSimilarTemplates } from '../services/ingestion/embeddings/src/search';
import { searchTransactions } from '../services/ingestion/embeddings/src/client';
import { DEFAULT_ANOMALY_K, DEFAULT_DISTANCE_THRESHOLD } from '../services/ingestion/embeddings/src/anomaly';

// Same text embed.ts uses to embed the three "normal" fixture transactions
// (`${docType} ${category} ${amount_cents} ${txn_date}`, all identical vet
// invoice fields — see fixtures/mock-db.json).
const VET_TXN_TEXT = 'vet_invoice veterinary 24469 2024-07-15';

// Matches the text the vet_invoice template fixture row was embedded from.
const VET_TEMPLATE_TEXT = 'vet_invoice veterinary invoice template';

// Matches the text the intentionally-weird seed transaction was embedded
// from (category "unclassified", currency XBT — nothing else on file
// resembles it). See fixtures/mock-db.json, id bbbbbbbb-...-000000000099.
const WEIRD_TXN_TEXT = 'anomalous_unclassified 9999999 crypto_wallet_transfer XBT 2019-01-01';
const WEIRD_TXN_ID = 'bbbbbbbb-0000-4000-8000-000000000099';

describe('searchSimilarTransactions — top-k ranking', () => {
  it('ranks exact-duplicate transactions first (distance 0) and the unrelated one last', async () => {
    const results = await searchSimilarTransactions(VET_TXN_TEXT, 10);

    expect(results.length).toBeGreaterThanOrEqual(4);
    // Results must be sorted ascending by distance.
    for (let i = 1; i < results.length; i++) {
      expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
    }

    const vetResults = results.filter((r) => r.category === 'veterinary');
    const weirdResult = results.find((r) => r.id === WEIRD_TXN_ID);
    expect(vetResults).toHaveLength(3);
    vetResults.forEach((r) => expect(r.distance).toBe(0));
    expect(weirdResult).toBeDefined();
    expect(weirdResult!.distance).toBeGreaterThan(vetResults[0].distance);

    // Top-k actually limits.
    const top1 = await searchSimilarTransactions(VET_TXN_TEXT, 1);
    expect(top1).toHaveLength(1);
    expect(top1[0].category).toBe('veterinary');
  });
});

describe('searchSimilarTemplates — top-k ranking (B3: "which template does this look like?")', () => {
  it('ranks the matching template first when the query embedding matches its stored embedding', async () => {
    const queryEmbedding = await embed(VET_TEMPLATE_TEXT);
    const results = await searchSimilarTemplates(queryEmbedding, 5);

    expect(results.length).toBe(3);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
    }
    expect(results[0].form_type).toBe('vet_invoice');
    expect(results[0].distance).toBe(0);
    expect(results[0].status).toBe('approved');
  });

  it('limits to the requested k', async () => {
    const queryEmbedding = await embed(VET_TEMPLATE_TEXT);
    const results = await searchSimilarTemplates(queryEmbedding, 1);
    expect(results).toHaveLength(1);
  });
});

describe('anomaly precondition — weird seed transaction has no close neighbors', () => {
  it('finds every neighbor of the weird transaction beyond the anomaly distance threshold', async () => {
    const queryEmbedding = await embed(WEIRD_TXN_TEXT);
    const neighbors = await searchTransactions(queryEmbedding, DEFAULT_ANOMALY_K, { excludeId: WEIRD_TXN_ID });

    expect(neighbors.length).toBeGreaterThan(0);
    neighbors.forEach((n) => expect(n.distance).toBeGreaterThan(DEFAULT_DISTANCE_THRESHOLD));
  });

  it('by contrast, a normal duplicate transaction has at least one very close neighbor', async () => {
    const queryEmbedding = await embed(VET_TXN_TEXT);
    // Exclude nothing in particular — just confirm duplicates see each other.
    const neighbors = await searchTransactions(queryEmbedding, DEFAULT_ANOMALY_K);
    expect(neighbors.some((n) => n.distance <= DEFAULT_DISTANCE_THRESHOLD)).toBe(true);
  });
});
