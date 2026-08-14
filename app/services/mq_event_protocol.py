"""Pure MES laboratory MQTT protocol parsing and normalization."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any


PROTOCOL_NAME = "MES_LAB_MQTT"
ACK_MESSAGE_TYPE = "EVENT_ACK"
EVENT_TYPES = {
    "FIXTURE_READY",
    "EXPERIMENT_STARTED",
    "EXPERIMENT_ENDED",
    "EXPERIMENT_PAUSED",
    "EXPERIMENT_RESUMED",
    "EXPERIMENT_STOPPED",
    "EXPERIMENT_RESULT",
}
EVENT_TYPE_BY_TOPIC_SUFFIX = {
    "fixture-ready": "FIXTURE_READY",
    "experiment-started": "EXPERIMENT_STARTED",
    "experiment-ended": "EXPERIMENT_ENDED",
    "experiment-paused": "EXPERIMENT_PAUSED",
    "experiment-resumed": "EXPERIMENT_RESUMED",
    "experiment-stopped": "EXPERIMENT_STOPPED",
    "experiment-result": "EXPERIMENT_RESULT",
}
BEIJING_TZ = timezone(timedelta(hours=8))


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def event_type_from_topic(topic: str) -> str:
    suffix = normalize_text(topic).rstrip("/").split("/")[-1]
    return EVENT_TYPE_BY_TOPIC_SUFFIX.get(suffix, "")


def topic_lab_code(topic: str) -> str:
    parts = [part for part in normalize_text(topic).split("/") if part]
    for index, part in enumerate(parts):
        if part == "labs" and index + 1 < len(parts):
            return parts[index + 1]
    return ""


def first_text(payload: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = normalize_text(payload.get(key))
        if value:
            return value
    return ""


def generated_message_id(message_type: str, lab_code: str, occurred_at: str) -> str:
    return f"HOST-{message_type}-{lab_code}-{occurred_at}"


def generated_run_no() -> str:
    return f"run-{datetime.now(BEIJING_TZ).strftime('%Y%m%d%H%M%S%f')}"


def parse_beijing_datetime(value: Any) -> datetime | None:
    normalized = normalize_text(value)
    if not normalized:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
        except ValueError:
            try:
                parsed = datetime.strptime(normalized, "%Y-%m-%d %H:%M:%S")
            except ValueError:
                return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(BEIJING_TZ).replace(tzinfo=None)
    return parsed


def mysql_datetime_text(value: Any) -> str:
    parsed = parse_beijing_datetime(value)
    if parsed is not None:
        return parsed.strftime("%Y-%m-%d %H:%M:%S")
    return normalize_text(value)


def parse_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0
