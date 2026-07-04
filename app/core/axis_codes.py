from __future__ import annotations

from typing import Any, Iterable


DEFAULT_AXIS_CODES: tuple[str, ...] = ("x+", "x-", "y+", "y-", "z+", "z-")
_AXIS_ORDER = {axis_code: index for index, axis_code in enumerate(DEFAULT_AXIS_CODES)}


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def canonical_axis_code(value: Any) -> str:
    normalized = normalize_text(value)
    lowered = normalized.lower()
    return lowered if lowered in _AXIS_ORDER else normalized


def sort_axis_codes(axis_codes: Iterable[Any]) -> list[str]:
    ordered: list[tuple[int, str]] = []
    seen: set[str] = set()
    for index, item in enumerate(axis_codes):
        axis_code = canonical_axis_code(item)
        dedupe_key = axis_code.lower()
        if not axis_code or dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        ordered.append((index, axis_code))
    ordered.sort(key=lambda item: (_AXIS_ORDER.get(item[1].lower(), len(_AXIS_ORDER)), item[0]))
    return [axis_code for _, axis_code in ordered]
