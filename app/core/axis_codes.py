from __future__ import annotations

from typing import Any, Iterable


IMPACT_AXIS_CODES: tuple[str, ...] = ("x+", "x-", "y+", "z+", "y-", "z-")
VIBRATION_AXIS_CODES: tuple[str, ...] = ("x", "y+", "z+", "y-", "z-")
DEFAULT_AXIS_CODES = IMPACT_AXIS_CODES
_AXIS_ORDER = {
    axis_code: index
    for index, axis_code in enumerate(("x", *IMPACT_AXIS_CODES))
}
_IMPACT_EXPERIMENT_TYPES = frozenset(("冲击试验", "冲击实验"))
_VIBRATION_EXPERIMENT_TYPES = frozenset(("振动试验", "振动实验"))


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def canonical_axis_code(value: Any) -> str:
    normalized = normalize_text(value)
    lowered = normalized.lower()
    return lowered if lowered in _AXIS_ORDER else normalized


def axis_codes_for_experiment_type(experiment_type: Any) -> tuple[str, ...]:
    normalized_type = normalize_text(experiment_type)
    if normalized_type in _IMPACT_EXPERIMENT_TYPES:
        return IMPACT_AXIS_CODES
    if normalized_type in _VIBRATION_EXPERIMENT_TYPES:
        return VIBRATION_AXIS_CODES
    return ()


def normalize_axis_codes_for_experiment_type(
    axis_codes: Iterable[Any],
    experiment_type: Any,
) -> list[str]:
    allowed_axis_codes = axis_codes_for_experiment_type(experiment_type)
    if not allowed_axis_codes:
        return []
    normalized: list[str] = []
    for item in axis_codes:
        axis_code = canonical_axis_code(item)
        if axis_code in allowed_axis_codes:
            normalized.append(axis_code)
    return [axis_code for axis_code in allowed_axis_codes if axis_code in set(normalized)]


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
