// C2: proves batch/task state survives an agent process restart.
//
// Unlike test/summaries.test.ts's vi.mock('.../client') pattern, this
// deliberately does NOT mock services/agent/src/client.ts -- the whole
// point of C2 is that state lives in CockroachDB (or, in mock mode, the
// on-disk fixtures/mock-db.json file this repo uses as a DB stand-in), not
// in memory. Mocking the client would just prove the mock returns what we
// tell it to.
//
// "Process restart" is simulated with vi.resetModules() + a dynamic
// re-import: that discards every module-level JS object (including
// client.ts's lazily-created pg Pool, if any) and forces batch-session.ts
// and client.ts to be re-evaluated from scratch, exactly as a fresh Lambda
// invocation / restarted CLI process would. The only thing carried across
// that boundary is whatever made it to disk.
//
// This test writes to the real checked-in services/agent/fixtures/mock-db.json
// (the same file agent:ask/agent:batch-* use locally) because that's the
// only way to exercise the actual client.ts code path -- MOCK_DB_PATH is a
// module-level constant, not overridable per test. The fixture's original
// contents are snapshotted in beforeAll and restored in afterAll so the
// working tree is clean again once the suite finishes.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

const FIXTURE_PATH = path.resolve(__dirname, '../services/agent/fixtures/mock-db.json');
let originalFixture: string;

beforeAll(() => {
  originalFixture = readFileSync(FIXTURE_PATH, 'utf-8');
});

afterAll(() => {
  writeFileSync(FIXTURE_PATH, originalFixture);
});

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const VOLUNTEER_ID = 'restart-test-volunteer';
const DOCUMENT_IDS = ['doc-a', 'doc-b', 'doc-c'];

describe('C2 — batch session state survives a simulated process restart', () => {
  it('resumes at the same document after start -> advance -> "kill" -> restart', async () => {
    // 1. Start a batch (process instance #1).
    vi.resetModules();
    const first = await import('../services/agent/src/batch-session.js');
    const started = await first.startBatch(DOCUMENT_IDS, ORG_ID, VOLUNTEER_ID);
    expect(started.batch_status).toBe('in_progress');
    expect(started.current_index).toBe(0);
    expect(started.batch_document_ids).toEqual(DOCUMENT_IDS);

    // 2. Process the first document and advance (still process instance #1).
    const advanced = await first.advanceBatch(started.id);
    expect(advanced.current_index).toBe(1);
    expect(advanced.batch_status).toBe('in_progress');

    // 3. "Kill" the process: drop every module-level object (in-memory pool,
    // any cached state) by resetting the module registry, then re-import
    // fresh -- this is a different module instance than `first`, standing in
    // for a brand-new Lambda cold start / restarted CLI process.
    vi.resetModules();
    const restarted = await import('../services/agent/src/batch-session.js');
    expect(restarted).not.toBe(first);

    // 4. On "login" the restarted process checks for an open session instead
    // of starting fresh -- this must resume exactly where #1 left off,
    // reading only from the on-disk fixture (nothing is shared in memory
    // between `first` and `restarted`).
    const resumed = await restarted.resumeOpenBatch(ORG_ID, VOLUNTEER_ID);
    expect(resumed).not.toBeNull();
    expect(resumed!.session.id).toBe(started.id);
    expect(resumed!.session.current_index).toBe(1);
    expect(resumed!.session.batch_document_ids).toEqual(DOCUMENT_IDS);
    expect(resumed!.nextDocumentId).toBe('doc-b');
    expect(restarted.currentBatchDocument(resumed!.session)).toBe('doc-b');

    // 5. Finish the batch on the restarted process; confirm it completes and
    // then no longer shows up as an open/resumable session.
    await restarted.advanceBatch(resumed!.session.id);
    const finalAdvance = await restarted.advanceBatch(resumed!.session.id);
    expect(finalAdvance.current_index).toBe(3);
    expect(finalAdvance.batch_status).toBe('completed');

    const noLongerOpen = await restarted.resumeOpenBatch(ORG_ID, VOLUNTEER_ID);
    expect(noLongerOpen).toBeNull();
  });

  it('returns null when there is nothing to resume for a fresh volunteer', async () => {
    vi.resetModules();
    const mod = await import('../services/agent/src/batch-session.js');
    const resumed = await mod.resumeOpenBatch(ORG_ID, 'a-volunteer-with-no-sessions-at-all');
    expect(resumed).toBeNull();
  });
});
