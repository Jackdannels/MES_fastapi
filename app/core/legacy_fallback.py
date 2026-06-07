from __future__ import annotations

from collections import Counter
import logging
from typing import Any

logger = logging.getLogger(__name__)
_hits: Counter[str] = Counter()
_last_details: dict[str, dict[str, Any]] = {}
_SAFE_DETAIL_KEYS = {
    "domain",
    "reason",
    "room",
    "source",
    "status",
    "target_is_fallback",
    "target_type",
}


def record_legacy_fallback_hit(fallback_id: str, **detail: Any) -> None:
    normalized_id = str(fallback_id or "").strip()
    if not normalized_id:
        return
    safe_detail = {key: str(value) for key, value in detail.items() if key in _SAFE_DETAIL_KEYS}
    _hits[normalized_id] += 1
    _last_details[normalized_id] = safe_detail
    logger.info(
        "legacy fallback hit",
        extra={
            "fallback_id": normalized_id,
            "legacy_fallback": _last_details[normalized_id],
            "legacy_fallback_hit": True,
        },
    )


def get_legacy_fallback_hits() -> list[dict[str, Any]]:
    return [
        {
            "count": count,
            "id": fallback_id,
            "last_detail": dict(_last_details.get(fallback_id, {})),
        }
        for fallback_id, count in sorted(_hits.items())
    ]


def reset_legacy_fallback_hits() -> None:
    _hits.clear()
    _last_details.clear()
