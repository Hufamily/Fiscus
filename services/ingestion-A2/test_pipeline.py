import json
import unittest

from app.bedrock import TerminalExtractionError, validate_extraction
from app.key import document_key, parse_document_key
from app.redaction import redact_extraction


class PipelineContractTests(unittest.TestCase):
    org_id = "123e4567-e89b-42d3-a456-426614174000"
    document_id = "223e4567-e89b-42d3-a456-426614174000"

    def test_tenant_scoped_original_key(self):
        key = document_key(self.org_id, self.document_id, "pdf")
        self.assertEqual(key, f"{self.org_id}/{self.document_id}/original.pdf")
        self.assertEqual(parse_document_key(key).document_id, self.document_id)
        with self.assertRaises(ValueError):
            parse_document_key(f"{self.org_id}/{self.document_id}/receipt.pdf")

    def test_schema_validation(self):
        result = validate_extraction(json.dumps({
            "vendor": "Community Market", "transactionDate": "2026-08-18", "amountCents": 1250,
            "currency": "usd", "lineItems": [{"description": "Food", "amountCents": 1250}],
        }))
        self.assertEqual(result["currency"], "USD")
        with self.assertRaises(TerminalExtractionError):
            validate_extraction('{"vendor":"invalid"}')

    def test_redaction_happens_before_persistence(self):
        result = redact_extraction({
            "vendor": "Card 4111 1111 1111 1111", "transactionDate": "2026-08-18", "amountCents": 1250,
            "currency": "USD", "lineItems": [{"description": "Payment 4111111111111111", "amountCents": 1250}],
        })
        self.assertNotIn("4111 1111 1111 1111", result["vendor"])
        self.assertNotIn("4111111111111111", result["lineItems"][0]["description"])


if __name__ == "__main__":
    unittest.main()
