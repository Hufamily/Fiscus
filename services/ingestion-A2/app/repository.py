from __future__ import annotations

import json
import uuid
from typing import Any

import psycopg

from .key import DocumentIdentity

# audit_log.actor_id is NOT NULL (see AGENTS.md §4); these two write paths
# run from the S3-triggered Lambda with no human volunteer in context, so
# they log under a fixed system-actor label, same convention documents.
# uploaded_by uses for non-human writers.
SYSTEM_ACTOR = "s3-lambda-bedrock"


class ExtractionRepository:
    def __init__(self, connection_string: str) -> None:
        self.connection_string = connection_string

    def record_upload(self, identity: DocumentIdentity, actor_id: str, doc_type: str = "receipt") -> None:
        with psycopg.connect(self.connection_string) as connection, connection.cursor() as cursor:
            cursor.execute(
                """INSERT INTO documents (id, org_id, s3_key, doc_type, status, uploaded_by)
                   VALUES (%s, %s, %s, %s, 'uploaded', %s) ON CONFLICT (id) DO NOTHING""",
                (identity.document_id, identity.org_id, identity.s3_key, doc_type, actor_id),
            )
            self._log(cursor, identity.org_id, actor_id, "document_uploaded", "documents", identity.document_id, {"s3Key": identity.s3_key})

    def save_extraction(self, identity: DocumentIdentity, extraction: dict[str, Any]) -> str:
        with psycopg.connect(self.connection_string) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT status FROM documents WHERE id = %s AND org_id = %s FOR UPDATE", (identity.document_id, identity.org_id))
            row = cursor.fetchone()
            if not row:
                raise ValueError("Document was not registered before extraction")
            cursor.execute("SELECT 1 FROM transactions WHERE document_id = %s AND org_id = %s", (identity.document_id, identity.org_id))
            if cursor.fetchone():
                return "duplicate"
            transaction_id = str(uuid.uuid4())
            cursor.execute(
                """INSERT INTO transactions (id, org_id, document_id, category, amount_cents, currency, txn_date, extracted_fields_json, status)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'pending_review')""",
                (transaction_id, identity.org_id, identity.document_id, extraction.get("category", "uncategorized"), extraction["amountCents"], extraction["currency"], extraction["transactionDate"], json.dumps({"vendor": extraction["vendor"], "lineItems": extraction["lineItems"]}),),
            )
            cursor.execute("UPDATE documents SET status = 'needs_review' WHERE id = %s AND org_id = %s", (identity.document_id, identity.org_id))
            self._log(cursor, identity.org_id, SYSTEM_ACTOR, "extraction_saved", "transactions", transaction_id, {"documentId": identity.document_id, "source": SYSTEM_ACTOR})
            return "saved"

    def mark_needs_review(self, identity: DocumentIdentity, reason: str) -> None:
        with psycopg.connect(self.connection_string) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM transactions WHERE document_id = %s AND org_id = %s", (identity.document_id, identity.org_id))
            if cursor.fetchone():
                return
            cursor.execute("UPDATE documents SET status = 'needs_review' WHERE id = %s AND org_id = %s", (identity.document_id, identity.org_id))
            self._log(cursor, identity.org_id, SYSTEM_ACTOR, "extraction_failed", "documents", identity.document_id, {"reason": reason, "source": SYSTEM_ACTOR})

    @staticmethod
    def _log(cursor: psycopg.Cursor[Any], org_id: str, actor_id: str | None, action: str, target_table: str, target_id: str, detail: dict[str, Any]) -> None:
        cursor.execute(
            """INSERT INTO audit_log (org_id, actor_id, action, target_table, target_id, detail_json)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (org_id, actor_id, action, target_table, target_id, json.dumps(detail)),
        )
