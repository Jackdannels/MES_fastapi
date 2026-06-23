from __future__ import annotations

from datetime import datetime
from typing import Any


APPEARANCE_INSPECTION_LOCATION = "外观检测间"
APPEARANCE_INSPECTION_DISPATCH_STATUS = "送至外观检测间"
APPEARANCE_INSPECTION_STOCKED_STATUS = "实验后外观检测间存放"
PRE_EXPERIMENT_APPEARANCE_STATUS = "实验前外观检测间存放"
APPEARANCE_REQUIRED_KEYWORDS = ("盐雾", "霉菌")
APPEARANCE_EVENT_ROOM = "appearance"
APPEARANCE_STOCK_IN_ACTION = "stock_in"
APPEARANCE_STOCK_OUT_ACTION = "stock_out"
STOCK_OUT_WITHDRAW_ACTION = "stock_out_withdraw"
LAB_DISPATCHED_STATUS = "送至实验室"
POST_EXPERIMENT_STAGING_STOCKED_STATUS = "实验后暂存间存放"

HANDOVER_LOCATION_KEYWORDS = ("接驳区",)
HANDOVER_STORED_STATUSES = {"到货"}
STAGING_LOCATION_KEYWORD = "暂存间"
STAGING_STORED_STATUSES = {
    "已到达暂存间",
    POST_EXPERIMENT_STAGING_STOCKED_STATUS,
}


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def parse_datetime_value(value: Any) -> datetime | None:
    normalized = normalize_text(value)
    if not normalized:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(normalized.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        try:
            return datetime.strptime(normalized, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None


def staging_event_room(event: Any) -> str:
    if not isinstance(event, dict):
        return ""
    return normalize_text(event.get("room") or event.get("storage_room") or event.get("storageRoom"))


def status_text(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    return normalize_text(value.get("status")) or normalize_text(value.get("flow_status"))


def tray_code_text(tray: Any) -> str:
    if not isinstance(tray, dict):
        return ""
    return normalize_text(tray.get("tray_code") or tray.get("trayCode") or tray.get("tray_no") or tray.get("trayNo"))


def experiment_requires_appearance_inspection(experiment_name: Any, experiment: dict[str, Any] | None = None) -> bool:
    texts = [
        experiment_name,
        (experiment or {}).get("experiment_name"),
        (experiment or {}).get("experiment_type"),
        (experiment or {}).get("test_type"),
        (experiment or {}).get("required_device"),
    ]
    joined = " / ".join(normalize_text(text) for text in texts if normalize_text(text))
    return any(keyword in joined for keyword in APPEARANCE_REQUIRED_KEYWORDS)


def experiment_name_by_code(experiments: Any, experiment_code: Any) -> str:
    normalized_code = normalize_text(experiment_code)
    if not normalized_code:
        return ""
    for experiment in experiments if isinstance(experiments, list) else []:
        if not isinstance(experiment, dict):
            continue
        if normalize_text(experiment.get("experiment_code") or experiment.get("experiment_no")) != normalized_code:
            continue
        return (
            normalize_text(experiment.get("experiment_name"))
            or normalize_text(experiment.get("experiment_type"))
            or normalize_text(experiment.get("test_type"))
            or normalize_text(experiment.get("required_device"))
        )
    return ""


def target_requires_appearance_inspection(
    *,
    target_lab: Any,
    target_experiment_code: Any,
    experiments: Any,
) -> bool:
    target_lab_name = normalize_text(target_lab)
    if any(keyword in target_lab_name for keyword in APPEARANCE_REQUIRED_KEYWORDS):
        return True
    experiment_name = experiment_name_by_code(experiments, target_experiment_code)
    return experiment_requires_appearance_inspection(experiment_name)


def source_is_handover_or_staging(*, source_location: Any, source_status: Any) -> bool:
    location = normalize_text(source_location)
    status = normalize_text(source_status)
    if location == APPEARANCE_INSPECTION_LOCATION or status in {
        PRE_EXPERIMENT_APPEARANCE_STATUS,
        APPEARANCE_INSPECTION_DISPATCH_STATUS,
        APPEARANCE_INSPECTION_STOCKED_STATUS,
    }:
        return False
    if any(keyword in location for keyword in HANDOVER_LOCATION_KEYWORDS) or status in HANDOVER_STORED_STATUSES:
        return True
    return STAGING_LOCATION_KEYWORD in location or status in STAGING_STORED_STATUSES


def should_route_pre_experiment_appearance(
    *,
    source_location: Any,
    source_status: Any,
    target_lab: Any,
    target_experiment_code: Any,
    experiments: Any,
) -> bool:
    return source_is_handover_or_staging(source_location=source_location, source_status=source_status) and target_requires_appearance_inspection(
        target_lab=target_lab,
        target_experiment_code=target_experiment_code,
        experiments=experiments,
    )


def appearance_flow_markers(sample: Any, staging_events: Any, tray_code: str) -> list[tuple[datetime, int, str]]:
    markers: list[tuple[datetime, int, str]] = []
    normalized_tray_code = normalize_text(tray_code)
    if not normalized_tray_code:
        return markers

    task_code = normalize_text(sample.get("task_code") or sample.get("task_no")) if isinstance(sample, dict) else ""
    sequence = 0
    for event in as_list(staging_events):
        if not isinstance(event, dict):
            continue
        if staging_event_room(event) != APPEARANCE_EVENT_ROOM:
            continue
        if normalize_text(event.get("tray_code") or event.get("trayCode")) != normalized_tray_code:
            continue
        event_task_code = normalize_text(event.get("task_code") or event.get("taskCode") or event.get("task_no") or event.get("taskNo"))
        if task_code and event_task_code and event_task_code != task_code:
            continue
        action = normalize_text(event.get("action"))
        if action not in {APPEARANCE_STOCK_IN_ACTION, APPEARANCE_STOCK_OUT_ACTION, STOCK_OUT_WITHDRAW_ACTION}:
            continue
        markers.append((parse_datetime_value(event.get("time")) or datetime.min, sequence, action))
        sequence += 1

    if isinstance(sample, dict):
        for entry in as_list(sample.get("history")):
            if not isinstance(entry, dict):
                continue
            action = normalize_text(entry.get("action"))
            marker_action = ""
            if action == "外观检测间扫码入库":
                marker_action = APPEARANCE_STOCK_IN_ACTION
            elif action == "外观检测间扫码出库":
                marker_action = APPEARANCE_STOCK_OUT_ACTION
            elif action in {"撤回出库", "实验任务撤回", "任务切换撤回"}:
                marker_action = STOCK_OUT_WITHDRAW_ACTION
            if not marker_action:
                continue
            detail = normalize_text(entry.get("detail"))
            entry_tray_code = normalize_text(entry.get("tray_code") or entry.get("trayCode"))
            if normalized_tray_code not in detail and entry_tray_code not in {"", normalized_tray_code}:
                continue
            markers.append((parse_datetime_value(entry.get("time")) or datetime.min, sequence, marker_action))
            sequence += 1

    markers.sort(key=lambda marker: (marker[0], marker[1]))
    return markers


def pre_experiment_appearance_already_dispatched(sample: Any, tray: Any, staging_events: Any) -> bool:
    if not isinstance(sample, dict) or not isinstance(tray, dict):
        return False
    sample_statuses = {
        normalize_text(sample.get("status")),
        normalize_text(sample.get("flow_status")),
    }
    if status_text(tray) != LAB_DISPATCHED_STATUS and LAB_DISPATCHED_STATUS not in sample_statuses:
        return False
    markers = appearance_flow_markers(sample, staging_events, tray_code_text(tray))
    if not markers:
        return False
    latest_action = markers[-1][2]
    return latest_action == APPEARANCE_STOCK_OUT_ACTION and any(
        action == APPEARANCE_STOCK_IN_ACTION for _, _, action in markers[:-1]
    )
