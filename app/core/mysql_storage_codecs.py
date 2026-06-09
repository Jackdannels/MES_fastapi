from __future__ import annotations

import json
import re
from datetime import date, datetime
from typing import Any, Dict

from app.core.storage_backend import CURRENT_SCHEMA_VERSION, STORAGE_META_KEY, _normalize_payload
from app.core.time_utils import format_business_datetime, now_business_datetime, parse_business_datetime

STORAGE_MARKER = "FRONTEND_STORAGE"
SAMPLE_META_PREFIX = f"{STORAGE_MARKER}:SAMPLE:"
TRAY_META_PREFIX = f"{STORAGE_MARKER}:TRAY"
FIXTURE_READY_COMPAT_MESSAGE_PREFIX = f"{STORAGE_MARKER}:FIXTURE_READY:"
RETENTION_KEYWORD = "暂存间"
SAMPLE_TASK_CODE_PATTERN = re.compile(r"^(?P<task_code>.+)-SP-\d+$")


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def parse_varchar_length(column: dict[str, Any] | None) -> int:
    column_type = normalize_text((column or {}).get("Type")).lower()
    matched = re.match(r"varchar\((\d+)\)", column_type)
    if not matched:
        return 0
    try:
        return int(matched.group(1))
    except ValueError:
        return 0


def derive_task_code_from_sample_code(sample_code: Any) -> str:
    text = normalize_text(sample_code)
    match = SAMPLE_TASK_CODE_PATTERN.match(text)
    if not match:
        return ""
    return normalize_text(match.group("task_code"))


def normalize_storage_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    normalized_payload, _changed = _normalize_payload(dict(payload))
    normalized_payload.setdefault(STORAGE_META_KEY, {"schema_version": CURRENT_SCHEMA_VERSION})
    return normalized_payload


def parse_storage_datetime(value: Any) -> datetime | None:
    return parse_business_datetime(value)


def current_beijing_datetime() -> datetime:
    return now_business_datetime()


def format_iso_storage_datetime(value: Any) -> str:
    return format_business_datetime(value)


def format_display_storage_datetime(value: Any) -> str:
    parsed = parse_storage_datetime(value) if not isinstance(value, datetime) else value
    if parsed is None:
        return ""
    return parsed.strftime("%Y-%m-%d %H:%M")


def parse_priority_value(value: Any) -> int | None:
    text = normalize_text(value)
    if not text:
        return None
    if text == "高":
        return 3
    if text == "中":
        return 2
    if text == "低":
        return 1
    try:
        parsed = int(text)
    except ValueError:
        return None
    return parsed


def format_priority_value(value: Any) -> str:
    if value in (3, "3"):
        return "高"
    if value in (2, "2"):
        return "中"
    if value in (1, "1"):
        return "低"
    return normalize_text(value)


def parse_int_value(value: Any) -> int | None:
    text = normalize_text(value)
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        return None


def parse_float_value(value: Any) -> float | None:
    text = normalize_text(value).replace("%", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def format_quality_value(value: Any) -> str:
    parsed = parse_float_value(value)
    if parsed is None:
        return "0.0%"
    text = f"{parsed:.2f}".rstrip("0").rstrip(".")
    if "." not in text:
        text = f"{text}.0"
    return f"{text}%"


def parse_bool_flag(value: Any) -> int:
    if isinstance(value, bool):
        return 1 if value else 0
    text = normalize_text(value).lower()
    return 1 if text in {"1", "true", "yes"} else 0


def parse_fixture_ready_flag(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    text = normalize_text(value).lower()
    return text in {"1", "true", "yes", "ready", "fixture_ready", "夹具安装完成"}


def parse_date_value(value: Any) -> date | None:
    text = normalize_text(value)
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


def format_date_value(value: Any) -> str:
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    text = normalize_text(value)
    if len(text) >= 10:
        return text[:10]
    return ""


def encode_sample_meta(*, owner: str = "", remark: str = "") -> str:
    payload = {"owner": normalize_text(owner), "remark": normalize_text(remark)}
    return f"{SAMPLE_META_PREFIX}{json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}"


def decode_sample_meta(value: Any) -> dict[str, str]:
    text = normalize_text(value)
    if not text.startswith(SAMPLE_META_PREFIX):
        return {"owner": "", "remark": text}
    raw_payload = text[len(SAMPLE_META_PREFIX) :]
    try:
        parsed = json.loads(raw_payload)
    except json.JSONDecodeError:
        return {"owner": "", "remark": ""}
    return {
        "owner": normalize_text(parsed.get("owner")),
        "remark": normalize_text(parsed.get("remark")),
    }
