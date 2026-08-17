from __future__ import annotations

import re
from typing import Any


def _digits(value: str) -> str:
    return "".join(char for char in value if char.isdigit())


def _passes_luhn(digits: str) -> bool:
    total = 0
    for index, char in enumerate(reversed(digits)):
        number = int(char)
        if index % 2:
            number *= 2
            if number > 9:
                number -= 9
        total += number
    return total % 10 == 0


def redact_text(value: str) -> str:
    def replace(match: re.Match[str]) -> str:
        candidate = match.group(0)
        digits = _digits(candidate)
        if not 13 <= len(digits) <= 19 or not _passes_luhn(digits):
            return candidate
        masked_digits = "X" * (len(digits) - 4) + digits[-4:]
        iterator = iter(masked_digits)
        return "".join(next(iterator) if char.isdigit() else char for char in candidate)

    return re.sub(r"[\d\-\s().*/]{13,160}", replace, value)


def redact_extraction(extraction: dict[str, Any]) -> dict[str, Any]:
    result = dict(extraction)
    result["vendor"] = redact_text(str(result["vendor"]))
    if isinstance(result.get("category"), str):
        result["category"] = redact_text(result["category"])
    result["lineItems"] = [
        {**item, "description": redact_text(str(item["description"]))}
        for item in result["lineItems"]
    ]
    return result
