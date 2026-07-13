from __future__ import annotations

from copy import deepcopy
from typing import Any


SAMPLES_KEY = "mes.samples"
STAGING_EVENTS_KEY = "mes.staging_events"
TASKS_KEY = "mes.tasks"

STAGING_ROOM = "staging"
APPEARANCE_ROOM = "appearance"
STAGING_LOCATION = "恒温恒湿间（暂存间）"
POST_EXPERIMENT_STAGING_LOCATION = "恒温恒湿间（实验后暂存间）"
APPEARANCE_LOCATION = "外观检测间"
RETURNED_STATUS = "厂家收回"

ROOM_CONFIGS = {
    STAGING_ROOM: {
        "event_room": STAGING_ROOM,
        "current_statuses": {"到货", "已到达暂存间", "暂存间存放", "实验后暂存间存放"},
        "duplicate_stock_in_error": "该托盘已完成暂存间扫码入库。",
        "history_stock_in_action": "暂存间扫码入库",
        "history_stock_out_action": "暂存间扫码出库",
        "requires_stock_in_error": "该托盘尚未完成暂存间扫码入库。",
        "stock_in_blocked_error": "该托盘已进入试验间流程，不能暂存间入库。",
        "stock_in_candidate_statuses": {"送至暂存间", "实验已完成", "实验完成"},
        "stock_in_location": STAGING_LOCATION,
        "stock_in_status": "已到达暂存间",
    },
    APPEARANCE_ROOM: {
        "event_room": APPEARANCE_ROOM,
        "current_statuses": {"实验后外观检测间存放", "实验前外观检测间存放"},
        "duplicate_stock_in_error": "该托盘已完成外观检测间扫码入库。",
        "history_stock_in_action": "外观检测间扫码入库",
        "history_stock_out_action": "外观检测间扫码出库",
        "requires_stock_in_error": "该托盘尚未完成外观检测间扫码入库。",
        "stock_in_blocked_error": "该托盘已进入试验间流程，不能外观检测间入库。",
        "stock_in_candidate_statuses": {"送至外观检测间"},
        "stock_in_location": APPEARANCE_LOCATION,
        "stock_in_status": "实验后外观检测间存放",
    },
}


class StorageTrayActionError(Exception):
    def __init__(self, detail: str, status_code: int = 400) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def room_config(room: str) -> dict[str, Any]:
    normalized_room = normalize_text(room) or STAGING_ROOM
    if normalized_room not in ROOM_CONFIGS:
        raise StorageTrayActionError("未知暂存区域。", status_code=404)
    return ROOM_CONFIGS[normalized_room]


def tray_code_value(tray: Any) -> str:
    if not isinstance(tray, dict):
        return ""
    return normalize_text(tray.get("tray_code") or tray.get("trayCode") or tray.get("tray_no") or tray.get("trayNo"))


def task_code_value(row: Any) -> str:
    if not isinstance(row, dict):
        return ""
    return normalize_text(row.get("task_code") or row.get("taskCode") or row.get("code"))


def tray_status(tray: Any) -> str:
    if not isinstance(tray, dict):
        return ""
    return normalize_text(tray.get("status") or tray.get("flow_status") or tray.get("tray_status") or tray.get("trayStatus"))


def is_partial_axis_completion_status(status: str) -> bool:
    text = normalize_text(status)
    if "部分完成" not in text or not text.endswith("轴"):
        return False
    try:
        progress = text.rsplit("部分完成", 1)[1].strip()
        completed, total = progress[:-1].split("/", 1)
        return int(completed) > 0 and int(total) > int(completed)
    except (ValueError, TypeError):
        return False


def allows_dispatched_pre_experiment_appearance_stock_in(config: dict[str, Any], current_status: str, payload: dict[str, Any]) -> bool:
    return (
        config["event_room"] == APPEARANCE_ROOM
        and current_status == "送至实验室"
        and normalize_text(payload.get("status")) == "实验前外观检测间存放"
    )


def allows_completed_post_experiment_appearance_stock_in(config: dict[str, Any], current_status: str, payload: dict[str, Any]) -> bool:
    requested_status = normalize_text(payload.get("status")) or config["stock_in_status"]
    return (
        config["event_room"] == APPEARANCE_ROOM
        and current_status in {"实验已完成", "实验完成", "实验已经完成"}
        and requested_status == "实验后外观检测间存放"
    )


def create_staging_event_id(tray_code: str, events: list[Any]) -> str:
    return f"staging-event-{tray_code}-{len(events) + 1}"


def create_history_id(sample: dict[str, Any], history: list[Any]) -> str:
    sample_id = normalize_text(sample.get("id")) or normalize_text(sample.get("code")) or "sample"
    return f"sample-event-{sample_id}-{len(history) + 1}"


def append_history(sample: dict[str, Any], *, action: str, detail: str, location: str, status: str, time: str, owner: str) -> None:
    history = [dict(entry) for entry in as_list(sample.get("history")) if isinstance(entry, dict)]
    history.insert(
        0,
        {
            "id": create_history_id(sample, history),
            "action": action,
            "detail": detail,
            "location": location,
            "owner": owner,
            "status": status,
            "time": time,
        },
    )
    sample["history"] = history


def find_samples_for_tray(samples: list[Any], tray_code: str) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    normalized_tray_code = normalize_text(tray_code)
    matches: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for sample in samples:
        if not isinstance(sample, dict):
            continue
        for tray in as_list(sample.get("trays")):
            if isinstance(tray, dict) and tray_code_value(tray) == normalized_tray_code:
                matches.append((sample, tray))
    return matches


def primary_status(matches: list[tuple[dict[str, Any], dict[str, Any]]]) -> str:
    for sample, tray in matches:
        status = tray_status(tray) or normalize_text(sample.get("status") or sample.get("flow_status"))
        if status:
            return status
    return ""


def primary_task_code(matches: list[tuple[dict[str, Any], dict[str, Any]]]) -> str:
    for sample, _tray in matches:
        task_code = task_code_value(sample)
        if task_code:
            return task_code
    return ""


def update_tray_samples(
    samples: list[Any],
    tray_code: str,
    *,
    history_action: str,
    history_detail: str,
    location: str,
    owner: str,
    status: str,
    target_experiment_code: str = "",
    target_experiment_name: str = "",
    target_lab: str = "",
    target_lab_code: str = "",
    target_lab_id: Any = "",
    target_type: str = "",
    time: str,
) -> list[dict[str, Any]]:
    normalized_tray_code = normalize_text(tray_code)
    updated_samples: list[dict[str, Any]] = []
    for sample in samples:
        if not isinstance(sample, dict):
            continue
        next_sample = deepcopy(sample)
        touched = False
        next_trays = []
        for tray in as_list(next_sample.get("trays")):
            if not isinstance(tray, dict):
                continue
            next_tray = dict(tray)
            if tray_code_value(next_tray) == normalized_tray_code:
                touched = True
                next_tray["status"] = status
                next_tray["updated_at"] = time
                if target_lab:
                    next_tray["target_lab"] = target_lab
                if target_lab_code:
                    next_tray["target_lab_code"] = target_lab_code
                if target_lab_id not in ("", None):
                    next_tray["target_lab_id"] = target_lab_id
                if target_experiment_code:
                    next_tray["target_experiment_code"] = target_experiment_code
                if target_experiment_name:
                    next_tray["target_experiment_name"] = target_experiment_name
                if target_type:
                    next_tray["target_type"] = target_type
            next_trays.append(next_tray)
        if touched:
            next_sample["location"] = location
            next_sample["status"] = status
            next_sample["flow_status"] = status
            next_sample["updated_at"] = time
            next_sample["trays"] = next_trays
            append_history(
                next_sample,
                action=history_action,
                detail=history_detail,
                location=location,
                owner=owner,
                status=status,
                time=time,
            )
        updated_samples.append(next_sample)
    return updated_samples


def task_is_fully_returned(samples: list[Any], task_code: str) -> bool:
    normalized_task_code = normalize_text(task_code)
    task_samples = [sample for sample in samples if isinstance(sample, dict) and task_code_value(sample) == normalized_task_code]
    if not task_samples:
        return False
    for sample in task_samples:
        trays = [tray for tray in as_list(sample.get("trays")) if isinstance(tray, dict)]
        if not trays:
            if normalize_text(sample.get("status") or sample.get("flow_status")) != RETURNED_STATUS:
                return False
            continue
        if any(tray_status(tray) != RETURNED_STATUS for tray in trays):
            return False
    return True


def maybe_mark_task_returned(tasks: list[Any], samples: list[Any], task_code: str) -> list[dict[str, Any]]:
    normalized_task_code = normalize_text(task_code)
    next_tasks = [deepcopy(task) for task in tasks if isinstance(task, dict)]
    if not task_is_fully_returned(samples, normalized_task_code):
        return next_tasks
    for task in next_tasks:
        if normalize_text(task.get("code") or task.get("task_code") or task.get("id")) == normalized_task_code:
            task["transfer_status"] = RETURNED_STATUS
    return next_tasks


def build_stock_out_updates(snapshot: dict[str, Any], *, room: str, tray_code: str, payload: dict[str, Any], now: str) -> dict[str, Any]:
    config = room_config(room)
    samples = [deepcopy(sample) for sample in as_list(snapshot.get(SAMPLES_KEY)) if isinstance(sample, dict)]
    events = [deepcopy(event) for event in as_list(snapshot.get(STAGING_EVENTS_KEY)) if isinstance(event, dict)]
    matches = find_samples_for_tray(samples, tray_code)
    if not matches:
        raise StorageTrayActionError("未找到对应的出库托盘。", status_code=404)
    current_status = primary_status(matches)
    if current_status not in config["current_statuses"]:
        raise StorageTrayActionError(config["requires_stock_in_error"], status_code=409)

    target_lab = normalize_text(payload.get("targetLab") or payload.get("target_lab") or payload.get("targetName") or payload.get("target_name"))
    target_lab_code = normalize_text(payload.get("targetLabCode") or payload.get("target_lab_code"))
    target_lab_id = payload.get("targetLabId") if "targetLabId" in payload else payload.get("target_lab_id", "")
    target_experiment_code = normalize_text(payload.get("targetExperimentCode") or payload.get("target_experiment_code"))
    target_experiment_name = normalize_text(payload.get("targetExperimentName") or payload.get("target_experiment_name"))
    target_type = normalize_text(payload.get("targetType") or payload.get("target_type")) or "lab"
    if not target_lab and not target_lab_code:
        raise StorageTrayActionError("请选择目标实验室后再出库。", status_code=400)

    normalized_tray_code = normalize_text(tray_code)
    task_code = primary_task_code(matches)
    is_staging_target = target_type == STAGING_ROOM or target_lab == STAGING_LOCATION
    location = STAGING_LOCATION if is_staging_target else target_lab
    status = "送至暂存间" if is_staging_target else "送至实验室"
    owner = normalize_text(payload.get("operator")) or "扫码登记"
    updated_samples = update_tray_samples(
        samples,
        normalized_tray_code,
        history_action=config["history_stock_out_action"],
        history_detail=f"{normalized_tray_code} 送至 {location}",
        location=location,
        owner=owner,
        status=status,
        target_experiment_code=target_experiment_code,
        target_experiment_name=target_experiment_name,
        target_lab=target_lab,
        target_lab_code=target_lab_code,
        target_lab_id=target_lab_id,
        target_type=target_type,
        time=now,
    )
    events.append(
        {
            "id": create_staging_event_id(normalized_tray_code, events),
            "tray_code": normalized_tray_code,
            "task_code": task_code,
            "room": config["event_room"],
            "action": "stock_out",
            "time": now,
            "operator": owner,
            "target_experiment_code": target_experiment_code,
            "target_experiment_name": target_experiment_name,
            "target_lab": target_lab,
            "target_lab_code": target_lab_code,
            "target_lab_id": target_lab_id,
            "target_type": target_type,
        }
    )
    return {SAMPLES_KEY: updated_samples, STAGING_EVENTS_KEY: events}


def build_stock_in_updates(snapshot: dict[str, Any], *, room: str, tray_code: str, payload: dict[str, Any], now: str) -> dict[str, Any]:
    config = room_config(room)
    samples = [deepcopy(sample) for sample in as_list(snapshot.get(SAMPLES_KEY)) if isinstance(sample, dict)]
    events = [deepcopy(event) for event in as_list(snapshot.get(STAGING_EVENTS_KEY)) if isinstance(event, dict)]
    matches = find_samples_for_tray(samples, tray_code)
    if not matches:
        raise StorageTrayActionError("未找到对应的入库托盘。", status_code=404)
    current_status = primary_status(matches)
    if current_status in config["current_statuses"]:
        raise StorageTrayActionError(config["duplicate_stock_in_error"], status_code=409)
    allows_partial_axis_stock_in = (
        config["event_room"] == STAGING_ROOM
        and is_partial_axis_completion_status(current_status)
    )
    allows_pre_experiment_appearance_stock_in = allows_dispatched_pre_experiment_appearance_stock_in(
        config,
        current_status,
        payload,
    )
    allows_post_experiment_appearance_stock_in = allows_completed_post_experiment_appearance_stock_in(
        config,
        current_status,
        payload,
    )
    if (
        current_status not in config["stock_in_candidate_statuses"]
        and not allows_partial_axis_stock_in
        and not allows_pre_experiment_appearance_stock_in
        and not allows_post_experiment_appearance_stock_in
    ):
        raise StorageTrayActionError(config["stock_in_blocked_error"], status_code=400)

    normalized_tray_code = normalize_text(tray_code)
    task_code = primary_task_code(matches)
    owner = normalize_text(payload.get("operator")) or "扫码登记"
    status = normalize_text(payload.get("status")) or config["stock_in_status"]
    location = normalize_text(payload.get("location")) or config["stock_in_location"]
    updated_samples = update_tray_samples(
        samples,
        normalized_tray_code,
        history_action=config["history_stock_in_action"],
        history_detail=f"{normalized_tray_code} {status}",
        location=location,
        owner=owner,
        status=status,
        time=now,
    )
    events.append(
        {
            "id": create_staging_event_id(normalized_tray_code, events),
            "tray_code": normalized_tray_code,
            "task_code": task_code,
            "room": config["event_room"],
            "action": "stock_in",
            "time": now,
            "operator": owner,
            "location": location,
            "status": status,
        }
    )
    return {SAMPLES_KEY: updated_samples, STAGING_EVENTS_KEY: events}


def build_manufacturer_return_updates(snapshot: dict[str, Any], *, room: str, tray_code: str, payload: dict[str, Any], now: str) -> dict[str, Any]:
    config = room_config(room)
    if config["event_room"] != STAGING_ROOM:
        raise StorageTrayActionError("外观检测间不允许厂家收回，请先出库至下一去向。", status_code=400)
    samples = [deepcopy(sample) for sample in as_list(snapshot.get(SAMPLES_KEY)) if isinstance(sample, dict)]
    tasks = [deepcopy(task) for task in as_list(snapshot.get(TASKS_KEY)) if isinstance(task, dict)]
    events = [deepcopy(event) for event in as_list(snapshot.get(STAGING_EVENTS_KEY)) if isinstance(event, dict)]
    matches = find_samples_for_tray(samples, tray_code)
    if not matches:
        raise StorageTrayActionError("未找到对应的出库托盘。", status_code=404)
    current_status = primary_status(matches)
    if current_status not in config["current_statuses"]:
        raise StorageTrayActionError(config["requires_stock_in_error"], status_code=409)

    normalized_tray_code = normalize_text(tray_code)
    task_code = primary_task_code(matches)
    owner = normalize_text(payload.get("operator")) or "扫码登记"
    updated_samples = update_tray_samples(
        samples,
        normalized_tray_code,
        history_action="厂家收回",
        history_detail=f"{normalized_tray_code} 厂家收回",
        location=RETURNED_STATUS,
        owner=owner,
        status=RETURNED_STATUS,
        time=now,
    )
    events.append(
        {
            "id": create_staging_event_id(normalized_tray_code, events),
            "tray_code": normalized_tray_code,
            "task_code": task_code,
            "room": config["event_room"],
            "action": "manufacturer_return",
            "time": now,
            "operator": owner,
            "target_lab": RETURNED_STATUS,
        }
    )
    return {
        TASKS_KEY: maybe_mark_task_returned(tasks, updated_samples, task_code),
        SAMPLES_KEY: updated_samples,
        STAGING_EVENTS_KEY: events,
    }


def summarize_tray_row(samples: list[Any], tray_code: str) -> dict[str, Any]:
    matches = find_samples_for_tray(samples, tray_code)
    quantity = len(matches)
    sample, tray = matches[0] if matches else ({}, {})
    return {
        "location": normalize_text(sample.get("location")),
        "quantity": quantity,
        "status": tray_status(tray) or normalize_text(sample.get("status") or sample.get("flow_status")),
        "taskCode": task_code_value(sample),
        "trayCode": normalize_text(tray_code),
    }
