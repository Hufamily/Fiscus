from __future__ import annotations

import json
import uuid
from typing import Any

import psycopg

from .key import DocumentIdentity


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
            if row[0] == "extracted":
                return "duplicate"
            transaction_id = str(uuid.uuid4())
            cursor.execute(
                """INSERT INTO transactions (id, org_id, document_id, category, amount_cents, currency, txn_date, extracted_fields_json, status)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'extracted') ON CONFLICT (document_id) DO NOTHING""",
                (transaction_id, identity.org_id, identity.document_id, extraction.get("category", "uncategorized"), extraction["amountCents"], extraction["currency"], extraction["transactionDate"], json.dumps({"vendor": extraction["vendor"], "lineItems": extraction["lineItems"]}),),
            )
            cursor.execute("SELECT id FROM transactions WHERE document_id = %s AND org_id = %s", (identity.document_id, identity.org_id))
            stored_transaction_id = cursor.fetchone()[0]
            cursor.execute("UPDATE documents SET status = 'extracted' WHERE id = %s AND org_id = %s", (identity.document_id, identity.org_id))
            self._log(cursor, identity.org_id, None, "extraction_saved", "transactions", stored_transaction_id, {"documentId": identity.document_id, "source": "s3-lambda-bedrock"})
            return "saved"

    def mark_needs_review(self, identity: DocumentIdentity, reason: str) -> None:
        with psycopg.connect(self.connection_string) as connection, connection.cursor() as cursor:
            cursor.execute("UPDATE documents SET status = 'needs_review' WHERE id = %s AND org_id = %s AND status <> 'extracted'", (identity.document_id, identity.org_id))
            self._log(cursor, identity.org_id, None, "extraction_failed", "documents", identity.document_id, {"reason": reason, "source": "s3-lambda-bedrock"})

    @staticmethod
    def _log(cursor: psycopg.Cursor[Any], org_id: str, actor_id: str | None, action: str, target_table: str, target_id: str, detail: dict[str, Any]) -> None:
        cursor.execute(
            """INSERT INTO audit_log (org_id, actor_id, action, target_table, target_id, detail_json)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (org_id, actor_id, action, target_table, target_id, json.dumps(detail)),
        )
