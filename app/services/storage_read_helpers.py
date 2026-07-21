from __future__ import annotations

from datetime import datetime
from typing import Any

from app.core.axis_codes import canonical_axis_code, sort_axis_codes
from app.core.time_utils import parse_business_datetime
from app.services.experiment_segments import resolve_record_sub_experiment_code

TRAY_QR_PREFIX = "MES-TRAY:"


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()

def _normalize_tray_scan_code(value: Any) -> str:
    normalized = _normalize_text(value)
    if normalized.upper().startswith(TRAY_QR_PREFIX):
        return normalized[len(TRAY_QR_PREFIX) :].strip()
    return normalized

def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []

def _parse_datetime(value: Any) -> datetime | None:
    return parse_business_datetime(value)

def _sample_code(sample: Any) -> str:
    return _normalize_text(sample.get("code")) if isinstance(sample, dict) else ""

def _tray_code(tray: Any) -> str:
    return _normalize_text(tray.get("tray_code")) if isinstance(tray, dict) else ""

def _task_code(row: Any) -> str:
    if not isinstance(row, dict):
        return ""
    return _normalize_text(row.get("task_code") or row.get("taskCode") or row.get("code"))

def _experiment_code(row: Any) -> str:
    if not isinstance(row, dict):
        return ""
    return _normalize_text(row.get("experiment_code") or row.get("experimentCode"))

def _status(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    return _normalize_text(value.get("status")) or _normalize_text(value.get("flow_status"))

def _schedule_id(schedule: Any) -> str:
    return _normalize_text(schedule.get("id")) if isinstance(schedule, dict) else ""

def _record_axis_batch_no(record: Any) -> str:
    return _normalize_text(record.get("axis_batch_no") or record.get("axisBatchNo")) if isinstance(record, dict) else ""

def _record_axis_codes(record: Any) -> list[str]:
    if not isinstance(record, dict):
        return []
    return _normalize_axis_codes(record.get("axis_codes") or record.get("axisCodes"))

def _normalize_axis_codes(value: Any) -> list[str]:
    if isinstance(value, list):
        raw_values = value
    elif isinstance(value, str):
        raw_values = value.replace("，", ",").split(",")
    else:
        raw_values = []
    axis_codes: list[str] = []
    seen: set[str] = set()
    for item in raw_values:
        axis_code = _normalize_text(item)
        if not axis_code or axis_code in seen:
            continue
        seen.add(axis_code)
        axis_codes.append(axis_code)
    return sort_axis_codes(axis_codes)

def _run_no(record: Any) -> str:
    return _normalize_text(record.get("run_no") or record.get("runNo") or record.get("id")) if isinstance(record, dict) else ""

def _record_schedule_id(record: Any) -> str:
    return _normalize_text(record.get("schedule_id") or record.get("scheduleId") or record.get("schedule_no")) if isinstance(record, dict) else ""

def _record_sub_code(record: Any, *, experiment_code: str = "") -> str:
    if not isinstance(record, dict):
        return ""
    return resolve_record_sub_experiment_code(record, experiment_code=experiment_code)
