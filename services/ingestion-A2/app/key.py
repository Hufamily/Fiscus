from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import unquote_plus

UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
KEY_PATTERN = re.compile(rf"^({UUID})/({UUID})/original\.(pdf|png|jpe?g)$", re.IGNORECASE)


@dataclass(frozen=True)
class DocumentIdentity:
    org_id: str
    document_id: str
    s3_key: str


def parse_document_key(key: str) -> DocumentIdentity:
    decoded = unquote_plus(key)
    match = KEY_PATTERN.fullmatch(decoded)
    if not match:
        raise ValueError("S3 key must match {org_id}/{document_id}/original.{ext}")
    return DocumentIdentity(org_id=match.group(1), document_id=match.group(2), s3_key=decoded)


def document_key(org_id: str, document_id: str, extension: str) -> str:
    normalized = extension.lower().lstrip(".")
    if normalized not in {"pdf", "png", "jpg", "jpeg"}:
        raise ValueError("Only PDF, PNG, JPG, and JPEG uploads are supported")
    return f"{org_id}/{document_id}/original.{normalized}"
