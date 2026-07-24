"""Attendance-specific business time parsing and serialization.

Naive business timestamps are deliberately interpreted in Asia/Shanghai while
repository timestamps remain UTC.  This is a business contract, not a generic
datetime utility.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any


BEIJING_TZ = timezone(timedelta(hours=8))


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def should_finish_work_interval_for_completion(*, axis_code: str = "", next_axis_code: str = "") -> bool:
    return not (normalize_text(axis_code) and normalize_text(next_axis_code))


def format_utc(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def format_beijing(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(BEIJING_TZ).isoformat(timespec="seconds")


def parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    normalized = normalize_text(value)
    if not normalized:
        return None
    for candidate in (normalized, normalized.replace("Z", "+00:00")):
        try:
            parsed = datetime.fromisoformat(candidate)
        except ValueError:
            continue
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    try:
        return datetime.strptime(normalized, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def parse_business_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=BEIJING_TZ).astimezone(timezone.utc)
        return value.astimezone(timezone.utc)
    normalized = normalize_text(value)
    if not normalized:
        return None
    for candidate in (normalized, normalized.replace("Z", "+00:00")):
        try:
            parsed = datetime.fromisoformat(candidate)
        except ValueError:
            continue
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=BEIJING_TZ).astimezone(timezone.utc)
        return parsed.astimezone(timezone.utc)
    try:
        return datetime.strptime(normalized, "%Y-%m-%d %H:%M:%S").replace(tzinfo=BEIJING_TZ).astimezone(timezone.utc)
    except ValueError:
        return None


def mysql_datetime(value: datetime | str | None) -> str | None:
    parsed = parse_datetime(value)
    if parsed is None:
        return None
    return parsed.astimezone(timezone.utc).replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S")
