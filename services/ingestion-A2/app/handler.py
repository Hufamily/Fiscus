from __future__ import annotations

import os
from typing import Any

import boto3

from .bedrock import TerminalExtractionError, extract_receipt
from .key import parse_document_key
from .redaction import redact_extraction
from .repository import ExtractionRepository


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def handler(event: dict[str, Any], _: Any) -> None:
    region = _required("AWS_REGION")
    model_id = _required("BEDROCK_MODEL_ID")
    repository = ExtractionRepository(_required("COCKROACH_DATABASE_URL"))
    s3 = boto3.client("s3", region_name=region)

    for record in event["Records"]:
        identity = parse_document_key(record["s3"]["object"]["key"])
        try:
            if model_id == "DISABLED":
                raise TerminalExtractionError("Bedrock extraction is disabled by the Free Tier cost guard")
            response = s3.get_object(Bucket=record["s3"]["bucket"]["name"], Key=identity.s3_key)
            content_type = response.get("ContentType")
            extraction = extract_receipt(region, model_id, response["Body"].read(), content_type)
            repository.save_extraction(identity, redact_extraction(extraction))
        except TerminalExtractionError as error:
            repository.mark_needs_review(identity, str(error))
