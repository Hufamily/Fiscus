from __future__ import annotations

import json
import re
from typing import Any

import boto3


class TerminalExtractionError(ValueError):
    """An invalid document or model response that should be surfaced for review."""


INSTRUCTION = """Extract this financial document. Return JSON only with this shape:
{"vendor":"string","transactionDate":"YYYY-MM-DD","amountCents":123,"currency":"USD","lineItems":[{"description":"string","quantity":1,"amountCents":123}],"category":"string"}.
Use integer cents. Do not include card numbers or raw document text."""


def extract_receipt(region: str, model_id: str, content: bytes, content_type: str) -> dict[str, Any]:
    if content_type == "application/pdf":
        document = {"format": "pdf", "name": "financial-document", "source": {"bytes": content}}
        blocks = [{"document": document}, {"text": INSTRUCTION}]
    elif content_type in {"image/jpeg", "image/png"}:
        image = {"format": "png" if content_type == "image/png" else "jpeg", "source": {"bytes": content}}
        blocks = [{"image": image}, {"text": INSTRUCTION}]
    else:
        raise TerminalExtractionError("Unsupported uploaded document type")

    response = boto3.client("bedrock-runtime", region_name=region).converse(
        modelId=model_id,
        messages=[{"role": "user", "content": blocks}],
        inferenceConfig={"maxTokens": 2000, "temperature": 0},
    )
    text = next((block.get("text") for block in response["output"]["message"]["content"] if "text" in block), None)
    if not text:
        raise TerminalExtractionError("Bedrock returned no extraction text")
    return validate_extraction(text)


def validate_extraction(text: str) -> dict[str, Any]:
    try:
        value = json.loads(text.removeprefix("```json").removesuffix("```").strip())
    except json.JSONDecodeError as error:
        raise TerminalExtractionError("Bedrock response was not valid JSON") from error

    required = ("vendor", "transactionDate", "amountCents", "currency", "lineItems")
    if not isinstance(value, dict) or any(field not in value for field in required):
        raise TerminalExtractionError("Bedrock extraction did not meet the receipt schema")
    if not isinstance(value["vendor"], str) or not isinstance(value["currency"], str) or not isinstance(value["amountCents"], int):
        raise TerminalExtractionError("Bedrock extraction did not meet the receipt schema")
    if not isinstance(value["transactionDate"], str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value["transactionDate"]) or not isinstance(value["lineItems"], list):
        raise TerminalExtractionError("Bedrock extraction did not meet the receipt schema")
    for item in value["lineItems"]:
        if not isinstance(item, dict) or not isinstance(item.get("description"), str) or not isinstance(item.get("amountCents"), int):
            raise TerminalExtractionError("Bedrock returned an invalid line item")
    value["currency"] = value["currency"].upper()
    return value
