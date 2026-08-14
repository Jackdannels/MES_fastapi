"""Salt-spray-only pause lifecycle helpers.

Commands do not mutate formal state. Only acknowledged upper-computer events call
the state transition helpers below.
"""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Any

from app.services.mq_event_protocol import mysql_datetime_text, normalize_text, parse_beijing_datetime


SALT_LAB_CODE = "LAB_SALT"
COMMAND_CONFIRMATION_TIMEOUT_SECONDS = 15
RUNNING = "实验进行中"
PAUSED = "实验暂停"
COMPLETED = "实验已完成"
ABNORMAL = "实验异常终止"
PAUSE_RESUMED = "实验已恢复"
PAUSE_STOPPED = "实验已停止"
TERMINATION_COMPLETION = "completion_criteria"
TERMINATION_ABNORMAL = "abnormal"
TERMINATION_TYPES = {TERMINATION_COMPLETION, TERMINATION_ABNORMAL}


def pause_no_from_payload(payload: dict[str, Any]) -> str:
    return normalize_text(payload.get("pause_no") or payload.get("pauseNo"))


def inspection_tray_codes(payload: dict[str, Any]) -> list[str]:
    raw = payload.get("inspection_tray_codes") or payload.get("inspectionTrayCodes") or []
    if isinstance(raw, str):
        raw = raw.replace("，", ",").split(",")
    if not isinstance(raw, list):
        return []
    result: list[str] = []
    for item in raw:
        value = normalize_text(item)
        if value and value not in result:
            result.append(value)
    return result


def assert_salt_run(run: dict[str, Any] | None, *, expected_status: str) -> dict[str, Any]:
    current = run or {}
    if normalize_text(current.get("lab_code")) != SALT_LAB_CODE:
        raise ValueError("盐雾暂停控制仅支持 LAB_SALT")
    if normalize_text(current.get("run_status") or current.get("status")) != expected_status:
        raise ValueError(f"当前实验状态必须为{expected_status}")
    return current


def shifted_planned_end(planned_end_at: Any, pause_seconds: int) -> str:
    parsed = parse_beijing_datetime(planned_end_at)
    if parsed is None:
        return ""
    return mysql_datetime_text(parsed + timedelta(seconds=max(0, int(pause_seconds))))


def decode_command_payload(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if not isinstance(value, str):
        return {}
    try:
        decoded = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return decoded if isinstance(decoded, dict) else {}
