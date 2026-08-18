// Entry point: `npm run api:dev` (tsx services/api/src/index.ts).
//
// Loads .env before anything else so COCKROACH_DATABASE_URL / AWS_* reach
// env.ts's IS_MOCK check. No other script in this repo auto-loads .env
// (CLI scripts expect the caller's shell to have exported it already —
// see db/migrate.ts); a long-running server is the one place that's worth
// doing for real, so it's done here rather than duplicated per-module.
// Handles this repo's actual .env formatting quirk (CLAUDE.md's A1
// learning): `KEY = "value"` (spaces around `=`, quoted values), not just
// plain dotenv `KEY=value`. Never logs values. Real environment variables
// (already exported, e.g. by CI or a real host) always win over the file.

import { readFileSync, existsSync } from 'fs';
import path from 'path';

function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  const lines = readFileSync(file, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(path.resolve(__dirname, '../../../.env'));

// IMPORTANT: this MUST be a dynamic import, not `import { createApp } from
// './server'` at the top of the file. A static import is hoisted and
// evaluated before any of this file's own top-level statements — including
// loadDotEnv() above it — so env.ts's IS_MOCK check (and every delegated
// module's own IS_MOCK check) would see an empty process.env and silently
// stay in mock mode even with a real .env present. Caught this exact bug
// via a real-mode smoke test against live CockroachDB/Bedrock credentials:
// the server logged "mock mode: false" (this file's own late check) while
// every response still came from fixtures/mock-db.json.
async function main(): Promise<void> {
  const { createApp } = await import('./server.js');
  const PORT = Number(process.env.PORT ?? 8080);
  const dbUrl = process.env.DATABASE_URL ?? process.env.COCKROACH_DATABASE_URL;
  const hasAws = !!(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE);
  const isMock = !dbUrl || !hasAws;

  const app = createApp();
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[services/api] listening on :${PORT} (mock mode: ${isMock})`);
  });
}

void main();
