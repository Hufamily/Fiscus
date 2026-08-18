import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { embed } from '../lib/embeddings';

// embed() checks AWS creds at *call* time (not module load), so a plain
// static import + per-test env override is safe here — unlike lib/audit.ts.
let originalKey: string | undefined;
let originalProfile: string | undefined;

beforeEach(() => {
  originalKey = process.env.AWS_ACCESS_KEY_ID;
  originalProfile = process.env.AWS_PROFILE;
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_PROFILE;
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.AWS_ACCESS_KEY_ID; else process.env.AWS_ACCESS_KEY_ID = originalKey;
  if (originalProfile === undefined) delete process.env.AWS_PROFILE; else process.env.AWS_PROFILE = originalProfile;
});

describe('embed — mock mode (no AWS creds configured)', () => {
  it('returns a vector matching the AGENTS.md §4 fixed dimension (1536, Titan)', async () => {
    const vec = await embed('veterinary invoice, $324.08');
    expect(vec).toHaveLength(1536);
  });

  it('every component is a finite number in [0, 1)', async () => {
    const vec = await embed('office supplies receipt');
    for (const x of vec) {
      expect(Number.isFinite(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('is deterministic — same text always yields the same vector', async () => {
    const a = await embed('recurring monthly donation');
    const b = await embed('recurring monthly donation');
    expect(a).toEqual(b);
  });

  it('gives different text a different vector', async () => {
    const a = await embed('veterinary invoice');
    const b = await embed('office supplies invoice');
    expect(a).not.toEqual(b);
  });

  it('handles an empty string without throwing', async () => {
    const vec = await embed('');
    expect(vec).toHaveLength(1536);
  });
});
