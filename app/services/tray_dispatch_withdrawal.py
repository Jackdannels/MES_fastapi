from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import HTTPException

from app.core.time_utils import now_business_text, parse_business_datetime
from app.services.appearance_inspection import APPEARANCE_EVENT_ROOM, PRE_EXPERIMENT_APPEARANCE_STATUS


TASK_STATUS_STORED = "到货"
HANDOVER_LOCATION = "接驳区"
STAGING_LOCATION = "恒温恒湿间（暂存间）"
APPEARANCE_LOCATION = "外观检测间"
APPEARANCE_STORED_STATUS = "实验后外观检测间存放"
MOLD_CANCEL_RECOVERY_STATUS = "霉菌取消后恢复处理中"
MOLD_CANCEL_RECOVERY_PHASE = "mold_cancel_recovery"
APPEARANCE_STORAGE_STATUSES = {
    APPEARANCE_STORED_STATUS,
    PRE_EXPERIMENT_APPEARANCE_STATUS,
    MOLD_CANCEL_RECOVERY_STATUS,
}
WITHDRAW_BLOCKED_TRAY_STATUSES = {
    "已到达实验室",
    "工装夹具安装",
    "实验准备就绪",
    "实验进行中",
    "实验中",
    "实验已完成",
    "实验完成",
    "实验已经完成",
    "实验后暂存间存放",
    "送至外观检测间",
    APPEARANCE_STORED_STATUS,
    "厂家收回",
}
TRAY_TARGET_FIELDS = (
    "target_lab",
    "target_lab_code",
    "target_lab_id",
    "target_experiment_code",
    "target_schedule_id",
    "target_sub_experiment_code",
    "target_axis_batch_no",
)
FIXTURE_READY_FIELDS = ("fixtureReady", "fixture_ready")


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def clear_fixture_ready_marker(tray: dict[str, Any]) -> None:
    for key in FIXTURE_READY_FIELDS:
        tray.pop(key, None)


def task_code(task: dict[str, Any]) -> str:
    return normalize_text(task.get("code") or task.get("task_code") or task.get("taskCode") or task.get("id"))


def parse_datetime_value(value: Any) -> datetime | None:
    return parse_business_datetime(value)


def append_history(sample: dict[str, Any], action: str, detail: str, timestamp: str) -> None:
    history = as_list(sample.get("history"))
    history.insert(
        0,
        {
            "id": f"sample-event-{normalize_text(sample.get('id')) or normalize_text(sample.get('code'))}-{len(history) + 1}",
            "time": timestamp,
            "action": action,
            "location": normalize_text(sample.get("location")),
            "owner": normalize_text(sample.get("owner")),
            "status": normalize_text(sample.get("status")),
            "detail": detail,
        },
    )
    sample["history"] = history


def staging_event_room(event: dict[str, Any]) -> str:
    return "appearance" if normalize_text(event.get("room") or event.get("storage_room") or event.get("storageRoom")) == "appearance" else "staging"


def staging_event_matches_room(event: dict[str, Any], room: str) -> bool:
    return staging_event_room(event) == ("appearance" if normalize_text(room) == "appearance" else "staging")


def latest_staging_event_for_tray(
    snapshot: dict[str, list[dict[str, Any]]],
    tray_code: str,
    *,
    action: str = "",
    room: str = "",
) -> dict[str, Any] | None:
    normalized_action = normalize_text(action)
    events = [
        dict(event)
        for event in as_list(snapshot.get("staging_events"))
        if normalize_text(event.get("tray_code")) == normalize_text(tray_code)
        and (not normalized_action or normalize_text(event.get("action")) == normalized_action)
        and (not normalize_text(room) or staging_event_matches_room(event, room))
    ]
    if not events:
        return None
    events.sort(key=lambda event: (parse_datetime_value(event.get("time")) or datetime.min, normalize_text(event.get("id"))))
    return events[-1]


def tray_is_currently_stocked_in_staging(snapshot: dict[str, list[dict[str, Any]]], tray_code: str) -> bool:
    event = latest_staging_event_for_tray(snapshot, tray_code, room="staging")
    return normalize_text(event.get("action") if event else "") in {"stock_in", "stock_out_withdraw"}


def sample_has_staging_dispatch_history(task_samples: list[dict[str, Any]], tray_code: str) -> bool:
    normalized = normalize_text(tray_code)
    entries = [
        dict(history)
        for sample in task_samples
        if any(normalize_text(item.get("tray_code")) == normalized for item in as_list(sample.get("trays")))
        for history in as_list(sample.get("history"))
        if normalize_text(history.get("action")) in {"暂存间扫码出库", "接驳区扫码出库", "送至实验室"}
    ]
    if not entries:
        return False
    entries.sort(key=lambda item: parse_datetime_value(item.get("time")) or datetime.min)
    return normalize_text(entries[-1].get("action")) == "暂存间扫码出库"


def latest_appearance_storage_status_for_tray(
    snapshot: dict[str, list[dict[str, Any]]],
    task_samples: list[dict[str, Any]],
    tray_code: str,
    dispatch_time: datetime,
) -> str:
    normalized = normalize_text(tray_code)
    candidates = []
    for event in as_list(snapshot.get("staging_events")):
        if normalize_text(event.get("tray_code")) != normalized or not staging_event_matches_room(event, "appearance"):
            continue
        if normalize_text(event.get("action")) != "stock_in":
            continue
        entry_time = parse_datetime_value(event.get("time")) or datetime.min
        if entry_time > dispatch_time:
            continue
        event_phase = normalize_text(event.get("appearance_phase") or event.get("appearancePhase"))
        event_status = normalize_text(event.get("status"))
        if event_phase == MOLD_CANCEL_RECOVERY_PHASE:
            event_status = MOLD_CANCEL_RECOVERY_STATUS
        if event_status in APPEARANCE_STORAGE_STATUSES:
            candidates.append({"status": event_status, "time": entry_time})
    for sample in task_samples:
        if not any(normalize_text(item.get("tray_code")) == normalized for item in as_list(sample.get("trays"))):
            continue
        for history in as_list(sample.get("history")):
            if normalize_text(history.get("action")) != "外观检测间扫码入库" or normalize_text(
                history.get("status")
            ) not in APPEARANCE_STORAGE_STATUSES:
                continue
            entry_time = parse_datetime_value(history.get("time")) or datetime.min
            if entry_time <= dispatch_time:
                candidates.append({"status": normalize_text(history.get("status")), "time": entry_time})
    if not candidates:
        return APPEARANCE_STORED_STATUS
    candidates.sort(key=lambda item: item["time"])
    return candidates[-1]["status"]


def restore_status_for_withdrawal(
    snapshot: dict[str, list[dict[str, Any]]], task_samples: list[dict[str, Any]], tray_code: str
) -> tuple[str, str, str]:
    normalized = normalize_text(tray_code)
    origin_candidates: list[dict[str, Any]] = []
    event = latest_staging_event_for_tray(snapshot, tray_code, action="stock_out")
    if event:
        origin_candidates.append(
            {
                "event": event,
                "scope": staging_event_room(event),
                "time": parse_datetime_value(event.get("time")) or datetime.min,
            }
        )
    history_scopes = {
        "接驳区扫码出库": "handover",
        "暂存间扫码出库": "staging",
        "外观检测间扫码出库": "appearance",
    }
    for sample in task_samples:
        if not any(normalize_text(item.get("tray_code")) == normalized for item in as_list(sample.get("trays"))):
            continue
        for history in as_list(sample.get("history")):
            scope = history_scopes.get(normalize_text(history.get("action")))
            if scope:
                origin_candidates.append(
                    {
                        "event": history,
                        "scope": scope,
                        "time": parse_datetime_value(history.get("time")) or datetime.min,
                    }
                )
    origin_candidates.sort(key=lambda item: item["time"])
    latest_origin = origin_candidates[-1] if origin_candidates else None
    if latest_origin:
        if latest_origin["scope"] == "appearance":
            dispatch_time = latest_origin["time"] or datetime.max
            return (
                latest_appearance_storage_status_for_tray(snapshot, task_samples, tray_code, dispatch_time),
                APPEARANCE_LOCATION,
                "appearance",
            )
        if latest_origin["scope"] == "staging":
            return "已到达暂存间", STAGING_LOCATION, "staging"
        return TASK_STATUS_STORED, HANDOVER_LOCATION, "handover"
    if sample_has_staging_dispatch_history(task_samples, tray_code):
        return "已到达暂存间", STAGING_LOCATION, "staging"
    return TASK_STATUS_STORED, HANDOVER_LOCATION, "handover"


def tray_has_laboratory_progress(task_samples: list[dict[str, Any]], tray_code: str) -> bool:
    normalized = normalize_text(tray_code)
    return any(
        normalize_text(entry.get("tray_code")) == normalized
        and normalize_text(entry.get("status")) in WITHDRAW_BLOCKED_TRAY_STATUSES
        for sample in task_samples
        for entry in as_list(sample.get("trays"))
    )


def tray_current_status(task_samples: list[dict[str, Any]], tray_code: str) -> str:
    normalized = normalize_text(tray_code)
    for sample in task_samples:
        for entry in as_list(sample.get("trays")):
            if normalize_text(entry.get("tray_code")) == normalized:
                return normalize_text(entry.get("status")) or normalize_text(sample.get("status"))
    return ""


def tray_is_currently_in_handover(task_samples: list[dict[str, Any]], tray_code: str) -> bool:
    normalized = normalize_text(tray_code)
    matched = []
    for sample in task_samples:
        entries = [entry for entry in as_list(sample.get("trays")) if normalize_text(entry.get("tray_code")) == normalized]
        if not entries:
            continue
        matched.append(sample)
        if (
            normalize_text(sample.get("status") or sample.get("flow_status")) != TASK_STATUS_STORED
            or normalize_text(sample.get("location")) != HANDOVER_LOCATION
            or any(normalize_text(entry.get("status")) != TASK_STATUS_STORED for entry in entries)
        ):
            return False
    return bool(matched)


def ensure_tray_currently_in_handover(task_samples: list[dict[str, Any]], tray_code: str) -> None:
    if not tray_is_currently_in_handover(task_samples, tray_code):
        raise HTTPException(status_code=400, detail="该托盘当前不在接驳区，不能从接驳区出库")


def ensure_tray_can_lookup_withdrawal(task_samples: list[dict[str, Any]], tray_code: str) -> None:
    status = tray_current_status(task_samples, tray_code)
    if tray_has_laboratory_progress(task_samples, tray_code):
        raise HTTPException(status_code=400, detail="该托盘已进入试验间流程，不能撤回出库")
    if status not in {"送至实验室", "送至暂存间"}:
        raise HTTPException(status_code=400, detail="该托盘当前不在可撤回的出库状态")


def apply_tray_withdrawal(
    snapshot: dict[str, list[dict[str, Any]]],
    task: dict[str, Any],
    task_samples: list[dict[str, Any]],
    tray_code: str,
    reason: str = "",
) -> dict[str, Any]:
    current_status = tray_current_status(task_samples, tray_code)
    if tray_has_laboratory_progress(task_samples, tray_code):
        raise HTTPException(status_code=400, detail="该托盘已进入试验间流程，不能撤回出库")
    if current_status not in {"送至实验室", "送至暂存间"}:
        raise HTTPException(status_code=400, detail="该托盘当前不在可撤回的出库状态")
    target_status, target_location, restore_scope = restore_status_for_withdrawal(snapshot, task_samples, tray_code)
    timestamp = now_business_text()
    normalized = normalize_text(tray_code)
    affected_count = 0
    for sample in task_samples:
        next_trays = []
        tray_matches = False
        for entry in as_list(sample.get("trays")):
            item = dict(entry)
            if normalize_text(item.get("tray_code")) == normalized:
                tray_matches = True
                item["status"] = target_status
                item["updated_at"] = timestamp
                clear_fixture_ready_marker(item)
                for key in TRAY_TARGET_FIELDS:
                    item.pop(key, None)
            next_trays.append(item)
        if not tray_matches:
            continue
        affected_count += 1
        if not any(
            normalize_text(item.get("tray_code")) != normalized
            and normalize_text(item.get("status")) in WITHDRAW_BLOCKED_TRAY_STATUSES
            for item in next_trays
        ):
            sample["location"] = target_location
            sample["status"] = target_status
            sample["flow_status"] = target_status
        sample["updated_at"] = timestamp
        sample["trays"] = next_trays
        detail = f"{normalized} 撤回出库至{target_status}"
        if normalize_text(reason):
            detail = f"{detail}（{normalize_text(reason)}）"
        append_history(sample, "撤回出库", detail, timestamp)
    if not affected_count:
        raise HTTPException(status_code=404, detail="未找到托盘")
    if restore_scope in {"staging", "appearance"}:
        latest_event = latest_staging_event_for_tray(snapshot, tray_code, action="stock_out", room=restore_scope) or {}
        event = {
            "id": f"staging-event-{normalized}-{len(snapshot['staging_events']) + 1}",
            "tray_code": normalized,
            "task_code": task_code(task),
            "action": "stock_out_withdraw",
            "time": timestamp,
            "operator": normalize_text(reason) or "撤回出库",
            "target_lab": normalize_text(latest_event.get("target_lab")),
            "target_experiment_code": normalize_text(latest_event.get("target_experiment_code")),
        }
        if restore_scope == "appearance":
            event["room"] = APPEARANCE_EVENT_ROOM
            event["status"] = target_status
            for metadata_key in (
                "appearance_phase",
                "recovery_cycle_id",
                "source_experiment_code",
                "source_run_no",
            ):
                metadata_value = normalize_text(latest_event.get(metadata_key))
                if metadata_value:
                    event[metadata_key] = metadata_value
        snapshot["staging_events"].append(event)
    return {
        "message": f"{normalized}已撤回出库",
        "affectedSampleCount": affected_count,
        "restoredStatus": target_status,
        "restoredLocation": target_location,
    }
