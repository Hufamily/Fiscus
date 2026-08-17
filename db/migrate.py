import os
from pathlib import Path

import psycopg


connection_string = os.environ.get("COCKROACH_DATABASE_URL")
if not connection_string:
    raise SystemExit("COCKROACH_DATABASE_URL is required to run migrations.")

with psycopg.connect(connection_string) as connection, connection.cursor() as cursor:
    cursor.execute("""CREATE TABLE IF NOT EXISTS schema_migrations (
        filename STRING PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )""")
    for migration in sorted(Path("db/migrations").glob("*.sql")):
        cursor.execute("SELECT 1 FROM schema_migrations WHERE filename = %s", (migration.name,))
        if cursor.fetchone():
            continue
        cursor.execute(migration.read_text(encoding="utf-8"))
        cursor.execute("INSERT INTO schema_migrations (filename) VALUES (%s)", (migration.name,))
        print(f"Applied {migration.name}")
