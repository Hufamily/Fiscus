import { describe, it, expect } from 'vitest';
import { embed } from '../lib/embeddings';
// Importing client sets FISCUS_MOCK_DB to this module's own fixtures/mock-db.json
// (see services/ingestion/embeddings/src/client.ts) — exercises the real mock-mode
// code path end to end rather than mocking it away.
import { searchTransactions } from '../services/ingestion/embeddings/src/client';

describe('embeddings integration (mock mode)', () => {
  it('embed() produces the fixed 1536-dim vector every vector index assumes (AGENTS.md §4)', async () => {
    const vector = await embed('vet invoice for Biscuit');
    expect(vector).toHaveLength(1536);
    expect(vector.every((n) => typeof n === 'number' && Number.isFinite(n))).toBe(true);
  });

  it('embed() is deterministic for the same input text', async () => {
    const a = await embed('same query text');
    const b = await embed('same query text');
    expect(a).toEqual(b);
  });

  it('embed() produces different vectors for different input text', async () => {
    const a = await embed('vet invoice');
    const b = await embed('office supplies');
    expect(a).not.toEqual(b);
  });

  it('searchTransactions() returns at most `limit` results shaped for the search API', async () => {
    const queryEmbedding = await embed('vet care spending');
    const results = await searchTransactions(queryEmbedding, 2);

    expect(results.length).toBeLessThanOrEqual(2);
    for (const r of results) {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('category');
      expect(r).toHaveProperty('amount_cents');
      expect(r).toHaveProperty('txn_date');
      expect(typeof r.distance).toBe('number');
    }
  });

  it('searchTransactions() defaults to a limit of 5 when none is given', async () => {
    const queryEmbedding = await embed('anything');
    const results = await searchTransactions(queryEmbedding);
    expect(results.length).toBeLessThanOrEqual(5);
  });
});
