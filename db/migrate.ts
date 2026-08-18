// db/migrate.ts — applies db/migrations/*.sql (in filename order) against
// COCKROACH_DATABASE_URL, tracked via a schema_migrations ledger so each
// file runs exactly once.
//
// Chose plain versioned .sql files + this small runner over a tool like
// dbmate: every migration so far (001-003) was already written as raw .sql
// by other tracks, everyone already has `pg` as a dependency, and adding a
// new binary to install isn't worth it against a hackathon deadline.
//
// Statements within a file run sequentially with no explicit transaction
// wrapper (not client.query('BEGIN') ... 'COMMIT'). CockroachDB disallows
// SET CLUSTER SETTING inside an explicit transaction, and A1's own
// migration needs one (to enable vector indexes) — so every migration here
// is plain autocommit-per-statement SQL, same as running each line through
// psql one at a time.
//
// Statement splitting is a naive split on ';' after stripping full-line
// `--` comments. That's safe for every migration in this repo today but
// would break on a statement containing a literal ';' inside a string —
// don't add one without upgrading this splitter.

import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import pg from 'pg';

const { Client } = pg;

const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');
const DB_URL = process.env.COCKROACH_DATABASE_URL ?? process.env.DATABASE_URL;
const DRY_RUN = process.argv.includes('--dry-run');

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function splitStatements(sql: string): string[] {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function main(): Promise<void> {
  if (!DB_URL) {
    console.log('Skipping CockroachDB migration: COCKROACH_DATABASE_URL is not configured.');
    return;
  }

  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const appliedRows = await client.query<{ filename: string }>('SELECT filename FROM schema_migrations');
    const applied = new Set(appliedRows.rows.map((r) => r.filename));
    const pending = migrationFiles().filter((f) => !applied.has(f));

    if (DRY_RUN) {
      console.log(`Connected to CockroachDB. ${pending.length} pending migration(s):`);
      pending.forEach((f) => console.log(`  - ${f}`));
      return;
    }

    if (pending.length === 0) {
      console.log('No pending migrations.');
      return;
    }

    for (const file of pending) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
      console.log(`Applying ${file}...`);
      for (const statement of splitStatements(sql)) {
        await client.query(statement);
      }
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      console.log('  done.');
    }
    console.log(`Applied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
