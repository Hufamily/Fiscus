#!/usr/bin/env bash
# Placeholder migration runner — replace with the real tool choice from
# issue A1 (e.g. dbmate, or a small custom runner over versioned .sql files).
set -euo pipefail

if [[ "${1:-}" == "--dry-run" ]]; then
  if [[ -z "${COCKROACH_DATABASE_URL:-}" ]]; then
    echo "Skipping CockroachDB migration dry run: COCKROACH_DATABASE_URL is not configured."
    exit 0
  fi

  echo "Migration dry run placeholder: CockroachDB dev-cluster credentials detected."
  echo "Issue A1 will execute the selected migration tool against db/migrations/*.sql."
  exit 0
fi

echo "TODO: implement migration runner (see issue A1)"
echo "Expected: apply db/migrations/*.sql against \$COCKROACH_DATABASE_URL"
