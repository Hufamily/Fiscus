#!/usr/bin/env bash
# Thin wrapper around db/migrate.ts (see that file for why: plain .sql +
# a small pg-based runner, tracked via a schema_migrations table).
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--dry-run" ]]; then
  if [[ -z "${COCKROACH_DATABASE_URL:-}" ]]; then
    echo "Skipping CockroachDB migration dry run: COCKROACH_DATABASE_URL is not configured."
    exit 0
  fi
  npx tsx db/migrate.ts --dry-run
  exit $?
fi

npx tsx db/migrate.ts
