from __future__ import annotations

import re
from typing import Any


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def record_sub_experiment_code(record: dict[str, Any] | None) -> str:
    if not isinstance(record, dict):
        return ""
    return normalize_text(
        record.get("sub_experiment_code")
        or record.get("subExperimentCode")
        or record.get("sub_experiment_no")
        or record.get("subExperimentNo")
    )


def record_axis_batch_no(record: dict[str, Any] | None) -> str:
    if not isinstance(record, dict):
        return ""
    return normalize_text(record.get("axis_batch_no") or record.get("axisBatchNo"))


def derived_axis_sub_experiment_code(experiment_code: Any, axis_batch_no: Any) -> str:
    normalized_experiment_code = normalize_text(experiment_code)
    normalized_batch_no = normalize_text(axis_batch_no)
    if not normalized_experiment_code or not normalized_batch_no:
        return ""
    if re.fullmatch(r"\d+", normalized_batch_no):
        normalized_batch_no = normalized_batch_no.zfill(3)
    return f"{normalized_experiment_code}-AXIS-{normalized_batch_no}"


def resolve_record_sub_experiment_code(record: dict[str, Any] | None, *, experiment_code: Any = "") -> str:
    return record_sub_experiment_code(record)


def same_sub_experiment(record: dict[str, Any] | None, sub_experiment_code: str) -> bool:
    normalized_sub_experiment_code = normalize_text(sub_experiment_code)
    if not normalized_sub_experiment_code:
        return True
    return record_sub_experiment_code(record) == normalized_sub_experiment_code
