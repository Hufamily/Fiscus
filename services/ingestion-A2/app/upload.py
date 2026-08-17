from __future__ import annotations

import uuid
from typing import Any

import boto3

from .key import DocumentIdentity, document_key
from .repository import ExtractionRepository

CONTENT_TYPES = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png"}


def create_upload(request: dict[str, Any], *, bucket: str, region: str, database_url: str, max_bytes: int = 10_000_000) -> dict[str, str]:
    content_type = request["contentType"]
    extension = CONTENT_TYPES.get(content_type)
    if not extension:
        raise ValueError("Unsupported document content type")
    if not isinstance(request["sizeBytes"], int) or not 1 <= request["sizeBytes"] <= max_bytes:
        raise ValueError("Document must be between 1 byte and 10 MB")
    document_id = str(uuid.uuid4())
    key = document_key(request["orgId"], document_id, extension)
    identity = DocumentIdentity(request["orgId"], document_id, key)
    ExtractionRepository(database_url).record_upload(identity, request["volunteerId"])
    upload_url = boto3.client("s3", region_name=region).generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": content_type, "ServerSideEncryption": "AES256"},
        ExpiresIn=300,
    )
    return {"documentId": document_id, "key": key, "uploadUrl": upload_url}
