"""Write-side transfer-area commands.

The HTTP route keeps request/snapshot lookup and response serialization; this
module owns the write-side state transitions.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Callable

from fastapi import HTTPException

from app.core.axis_codes import sort_axis_codes
from app.core.storage_backend import normalize_experiment_status_text
from app.core.time_utils import now_business_datetime, now_business_text, parse_business_datetime
from app.services.appearance_inspection import (
    APPEARANCE_EVENT_ROOM,
    APPEARANCE_STOCK_OUT_ACTION,
    PRE_EXPERIMENT_APPEARANCE_STATUS,
)
from app.services.laboratory_operations import clear_fixture_ready_marker
from app.services.laboratory_completion import tray_assigned_experiments_are_completed
from app.api.routes.transfer_area_views import as_list, normalize_text, sample_code, sample_key, task_code

TASK_STATUS_PENDING = "未入库"
TASK_STATUS_STORED = "到货"
HANDOVER_LOCATION = "接驳区"
STAGING_LOCATION = "恒温恒湿间（暂存间）"
APPEARANCE_LOCATION = "外观检测间"
APPEARANCE_STORED_STATUS = "实验后外观检测间存放"
TRANSFER_HISTORY_ACTIONS = {"样品分装托盘", "任务已确认入库", "任务重新载装", "任务重新入库"}
TRAY_QR_PREFIX = "MES-TRAY:"
TASK_TRAY_ID_BASE = 1000
STOCK_TRAY_ID_BASE = 2000
TRAY_CODE_PATTERN = re.compile(r"-TP-(\d+)$")
STOCK_TRAY_CODE_PATTERN = re.compile(r"^STOCK-TP-(\d+)$")
WITHDRAW_BLOCKED_TRAY_STATUSES = {
    "已到达实验室", "工装夹具安装", "实验准备就绪", "实验进行中", "实验中",
    "实验已完成", "实验完成", "实验已经完成", "实验后暂存间存放", "送至外观检测间",
    APPEARANCE_STORED_STATUS, "厂家收回",
}
TRAY_OUTBOUND_STATUSES = {
    "送至暂存间", "已到达暂存间", "送至实验室", "已到达实验室", "工装夹具安装",
    "实验准备就绪", "实验进行中", "实验已完成", "实验后暂存间存放", "送至外观检测间",
    APPEARANCE_STORED_STATUS, PRE_EXPERIMENT_APPEARANCE_STATUS, "厂家收回",
}
TRAY_LAB_REDISPATCH_STATUSES = {
    "已到达暂存间", "实验后暂存间存放", "送至外观检测间", APPEARANCE_STORED_STATUS,
    PRE_EXPERIMENT_APPEARANCE_STATUS, "实验完成", "实验已经完成", "实验已完成",
}


def parse_datetime_value(value: Any) -> datetime | None:
    return parse_business_datetime(value)


def normalize_axis_codes(value: Any) -> list[str]:
    raw_values = value if isinstance(value, list) else str(value or "").replace("，", ",").split(",") if isinstance(value, str) else []
    axis_codes: list[str] = []
    seen: set[str] = set()
    for item in raw_values:
        axis_code = normalize_text(item)
        if axis_code and axis_code not in seen:
            seen.add(axis_code)
            axis_codes.append(axis_code)
    return sort_axis_codes(axis_codes)


def is_staging_device(value: Any) -> bool:
    return "暂存间" in normalize_text(value)


def device_is_unavailable(device: dict[str, Any] | None) -> bool:
    if not device:
        return False
    status = normalize_text(device.get("status"))
    start_at = parse_datetime_value(device.get("maintenance_start_at") or device.get("maintenanceStartAt"))
    end_at = parse_datetime_value(device.get("maintenance_end_at") or device.get("maintenanceEndAt"))
    now = now_business_datetime()
    if any(keyword in status for keyword in ["停用", "禁用", "不可用"]):
        return True
    if any(keyword in status for keyword in ["维修", "保养"]) and not (end_at and end_at < now):
        return True
    return bool(start_at and start_at <= now and (not end_at or now <= end_at))


def find_unavailable_device(snapshot: dict[str, list[dict[str, Any]]], device_name: str) -> dict[str, Any] | None:
    normalized_device = normalize_text(device_name)
    for device in snapshot.get("devices", []):
        if normalized_device in {normalize_text(device.get("code")), normalize_text(device.get("name"))} and device_is_unavailable(device):
            return device
    return None


def has_formal_schedule(snapshot: dict[str, list[dict[str, Any]]], task_code_value: str, experiment_code_value: str) -> bool:
    return any(
        normalize_text(item.get("task_code")) == task_code_value
        and normalize_text(item.get("experiment_code")) == experiment_code_value
        and normalize_text(item.get("device"))
        and not is_staging_device(item.get("device"))
        for item in snapshot["schedules"]
    )


def task_has_schedule(snapshot: dict[str, list[dict[str, Any]]], task_code_value: str) -> bool:
    normalized = normalize_text(task_code_value)
    return any(normalize_text(item.get("task_code") or item.get("taskCode")) == normalized for item in as_list(snapshot.get("schedules")) if isinstance(item, dict))


def reset_task_schedules_for_reschedule(snapshot: dict[str, list[dict[str, Any]]], task_code_value: str) -> bool:
    normalized = normalize_text(task_code_value)
    if not normalized or not task_has_schedule(snapshot, normalized):
        return False
    snapshot["schedules"] = [item for item in snapshot["schedules"] if normalize_text(item.get("task_code") or item.get("taskCode")) != normalized]
    timestamp = now_business_text()
    for experiment in snapshot["experiments"]:
        if normalize_text(experiment.get("task_code") or experiment.get("taskCode")) == normalized:
            experiment["status"] = "待排程"
            experiment["unscheduled_since"] = timestamp
    return True


def decode_tray_id(task_code_value: str, tray_id: int) -> tuple[int, str]:
    if tray_id >= STOCK_TRAY_ID_BASE:
        serial = tray_id - STOCK_TRAY_ID_BASE
        return serial, f"STOCK-TP-{serial:03d}"
    serial = tray_id - TASK_TRAY_ID_BASE
    return serial, f"{task_code_value}-TP-{serial:03d}"


def normalize_tray_scan_code(value: Any) -> str:
    normalized = normalize_text(value)
    return normalized[len(TRAY_QR_PREFIX):].strip() if normalized.upper().startswith(TRAY_QR_PREFIX) else normalized


def append_history(sample: dict[str, Any], action: str, detail: str) -> None:
    history = as_list(sample.get("history"))
    history.insert(0, {
        "id": f"sample-event-{normalize_text(sample.get('id')) or normalize_text(sample.get('code'))}-{len(history) + 1}",
        "time": now_business_text(), "action": action, "location": normalize_text(sample.get("location")),
        "owner": normalize_text(sample.get("owner")), "status": normalize_text(sample.get("status")), "detail": detail,
    })
    sample["history"] = history


def clear_transfer_history(sample: dict[str, Any]) -> None:
    sample["history"] = [entry for entry in as_list(sample.get("history")) if normalize_text(entry.get("action")) not in TRANSFER_HISTORY_ACTIONS]


def validate_complete_experiment_tray_refs(task_experiment_codes: set[str], loaded_tray_refs: set[Any], experiment_tray_refs_by_code: dict[str, set[Any]]) -> None:
    if not task_experiment_codes:
        return
    selected = {code for code, refs in experiment_tray_refs_by_code.items() if refs}
    if selected - task_experiment_codes:
        raise HTTPException(status_code=400, detail="实验托盘分配信息不完整")
    if selected != task_experiment_codes:
        raise HTTPException(status_code=400, detail="每个实验都必须至少分配一个托盘")
    selected_refs = {ref for refs in experiment_tray_refs_by_code.values() for ref in refs}
    if not selected_refs.issubset(loaded_tray_refs):
        raise HTTPException(status_code=400, detail="实验托盘分配引用了无效托盘")
    if loaded_tray_refs and selected_refs != loaded_tray_refs:
        raise HTTPException(status_code=400, detail="有样品的托盘必须至少分配一个实验")


def task_experiment_code_set(task: dict[str, Any], experiments: list[dict[str, Any]]) -> set[str]:
    return {normalize_text(item.get("experiment_code")) for item in experiments if normalize_text(item.get("task_code")) == task_code(task) and normalize_text(item.get("experiment_code"))}


def validate_saved_experiment_tray_allocation(task: dict[str, Any], task_samples: list[dict[str, Any]], experiments: list[dict[str, Any]], experiment_trays: list[dict[str, Any]]) -> None:
    loaded = {normalize_text(tray.get("tray_code")) for sample in task_samples for tray in as_list(sample.get("trays")) if normalize_text(tray.get("tray_code"))}
    refs: dict[str, set[str]] = {}
    task_code_value = task_code(task)
    for entry in experiment_trays:
        if normalize_text(entry.get("task_code")) == task_code_value:
            experiment_code = normalize_text(entry.get("experiment_code"))
            tray_code = normalize_text(entry.get("tray_code"))
            if experiment_code and tray_code:
                refs.setdefault(experiment_code, set()).add(tray_code)
    validate_complete_experiment_tray_refs(task_experiment_code_set(task, experiments), loaded, refs)


def update_task_samples_for_pending(task: dict[str, Any], task_samples: list[dict[str, Any]]) -> None:
    for sample in task_samples:
        sample["location"] = ""
        sample["status"] = "运输中"
        sample["flow_status"] = "运输中"


def staging_event_room(event: dict[str, Any]) -> str:
    return "appearance" if normalize_text(event.get("room") or event.get("storage_room") or event.get("storageRoom")) == "appearance" else "staging"


def staging_event_matches_room(event: dict[str, Any], room: str) -> bool:
    return staging_event_room(event) == ("appearance" if normalize_text(room) == "appearance" else "staging")


def latest_staging_event_for_tray(snapshot: dict[str, list[dict[str, Any]]], tray_code: str, *, action: str = "", room: str = "") -> dict[str, Any] | None:
    normalized_action = normalize_text(action)
    events = [dict(event) for event in as_list(snapshot.get("staging_events")) if normalize_text(event.get("tray_code")) == normalize_text(tray_code) and (not normalized_action or normalize_text(event.get("action")) == normalized_action) and (not normalize_text(room) or staging_event_matches_room(event, room))]
    if not events:
        return None
    events.sort(key=lambda event: (parse_datetime_value(event.get("time")) or datetime.min, normalize_text(event.get("id"))))
    return events[-1]


def tray_is_currently_stocked_in_staging(snapshot: dict[str, list[dict[str, Any]]], tray_code: str) -> bool:
    event = latest_staging_event_for_tray(snapshot, tray_code, room="staging")
    return normalize_text(event.get("action") if event else "") in {"stock_in", "stock_out_withdraw"}


def sample_has_staging_dispatch_history(task_samples: list[dict[str, Any]], tray_code: str) -> bool:
    normalized = normalize_text(tray_code)
    entries = [dict(history) for sample in task_samples if any(normalize_text(item.get("tray_code")) == normalized for item in as_list(sample.get("trays"))) for history in as_list(sample.get("history")) if normalize_text(history.get("action")) in {"暂存间扫码出库", "接驳区扫码出库", "送至实验室"}]
    if not entries:
        return False
    entries.sort(key=lambda item: parse_datetime_value(item.get("time")) or datetime.min)
    return normalize_text(entries[-1].get("action")) == "暂存间扫码出库"


def latest_appearance_storage_status_for_tray(task_samples: list[dict[str, Any]], tray_code: str, dispatch_time: datetime) -> str:
    normalized = normalize_text(tray_code)
    candidates = []
    for sample in task_samples:
        if not any(normalize_text(item.get("tray_code")) == normalized for item in as_list(sample.get("trays"))):
            continue
        for history in as_list(sample.get("history")):
            if normalize_text(history.get("action")) != "外观检测间扫码入库" or normalize_text(history.get("status")) not in {APPEARANCE_STORED_STATUS, PRE_EXPERIMENT_APPEARANCE_STATUS}:
                continue
            entry_time = parse_datetime_value(history.get("time")) or datetime.min
            if entry_time <= dispatch_time:
                candidates.append({"status": normalize_text(history.get("status")), "time": entry_time})
    if not candidates:
        return APPEARANCE_STORED_STATUS
    candidates.sort(key=lambda item: item["time"])
    return candidates[-1]["status"]


def restore_status_for_withdrawal(snapshot: dict[str, list[dict[str, Any]]], task_samples: list[dict[str, Any]], tray_code: str) -> tuple[str, str, str]:
    event = latest_staging_event_for_tray(snapshot, tray_code, action="stock_out")
    if event:
        if staging_event_matches_room(event, "appearance"):
            dispatch_time = parse_datetime_value(event.get("time")) or datetime.max
            return latest_appearance_storage_status_for_tray(task_samples, tray_code, dispatch_time), APPEARANCE_LOCATION, "appearance"
        return "已到达暂存间", STAGING_LOCATION, "staging"
    if sample_has_staging_dispatch_history(task_samples, tray_code):
        return "已到达暂存间", STAGING_LOCATION, "staging"
    return "到货", HANDOVER_LOCATION, "handover"


def tray_has_laboratory_progress(task_samples: list[dict[str, Any]], tray_code: str) -> bool:
    normalized = normalize_text(tray_code)
    return any(normalize_text(entry.get("tray_code")) == normalized and normalize_text(entry.get("status")) in WITHDRAW_BLOCKED_TRAY_STATUSES for sample in task_samples for entry in as_list(sample.get("trays")))


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
        if normalize_text(sample.get("status") or sample.get("flow_status")) != TASK_STATUS_STORED or normalize_text(sample.get("location")) != HANDOVER_LOCATION or any(normalize_text(entry.get("status")) != TASK_STATUS_STORED for entry in entries):
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


def apply_tray_withdrawal(snapshot: dict[str, list[dict[str, Any]]], task: dict[str, Any], task_samples: list[dict[str, Any]], tray_code: str, reason: str = "") -> dict[str, Any]:
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
            next_trays.append(item)
        if not tray_matches:
            continue
        affected_count += 1
        if not any(normalize_text(item.get("tray_code")) != normalized and normalize_text(item.get("status")) in WITHDRAW_BLOCKED_TRAY_STATUSES for item in next_trays):
            sample["location"] = target_location
            sample["status"] = target_status
            sample["flow_status"] = target_status
        sample["updated_at"] = timestamp
        sample["trays"] = next_trays
        detail = f"{normalized} 撤回出库至{target_status}"
        if normalize_text(reason):
            detail = f"{detail}（{normalize_text(reason)}）"
        append_history(sample, "撤回出库", detail)
    if not affected_count:
        raise HTTPException(status_code=404, detail="未找到托盘")
    if restore_scope in {"staging", "appearance"}:
        latest_event = latest_staging_event_for_tray(snapshot, tray_code, action="stock_out", room=restore_scope) or {}
        event = {
            "id": f"staging-event-{normalized}-{len(snapshot['staging_events']) + 1}", "tray_code": normalized,
            "task_code": task_code(task), "action": "stock_out_withdraw", "time": timestamp,
            "operator": normalize_text(reason) or "撤回出库", "target_lab": normalize_text(latest_event.get("target_lab")),
            "target_experiment_code": normalize_text(latest_event.get("target_experiment_code")),
        }
        if restore_scope == "appearance":
            event["room"] = APPEARANCE_EVENT_ROOM
        snapshot["staging_events"].append(event)
    return {"message": f"{normalized}已撤回出库", "affectedSampleCount": affected_count, "restoredStatus": target_status, "restoredLocation": target_location}


def apply_dispatch(
    snapshot: dict[str, list[dict[str, Any]]], task: dict[str, Any], tray_samples: list[dict[str, Any]], tray_code: str,
    request: Any, *, partial_axis_batch_completed: bool, serialize_dispatch: Callable[..., dict[str, Any]], update_source: str = "", update_request_id: str = "", write_snapshot: Callable[..., Any],
) -> dict[str, Any]:
    current_status = ""
    current_target_sub_experiment_code = ""
    for sample in tray_samples:
        for entry in as_list(sample.get("trays")):
            if normalize_text(entry.get("tray_code")) == normalize_text(tray_code):
                current_status = normalize_text(entry.get("status"))
                current_target_sub_experiment_code = normalize_text(entry.get("target_sub_experiment_code") or entry.get("targetSubExperimentCode"))
                break
        if current_status:
            break
    target_type = normalize_text(request.target_type)
    target_name = normalize_text(request.target_name)
    assigned_codes = {normalize_text(item.get("experiment_code") or item.get("experiment_no")) for item in as_list(snapshot["experiment_trays"]) if normalize_text(item.get("task_code") or item.get("task_no")) == task_code(task) and normalize_text(item.get("tray_code") or item.get("tray_no")) == normalize_text(tray_code) and normalize_text(item.get("experiment_code") or item.get("experiment_no"))}
    axis_codes: set[str] = set()
    if current_target_sub_experiment_code or partial_axis_batch_completed:
        for items in (snapshot["experiments"], snapshot["schedules"]):
            axis_codes.update(normalize_text(item.get("experiment_code") or item.get("experiment_no")) for item in as_list(items) if normalize_text(item.get("task_code") or item.get("task_no")) == task_code(task) and normalize_text(item.get("experiment_code") or item.get("experiment_no")) in assigned_codes and normalize_axis_codes(item.get("axis_codes") or item.get("axisCodes")))
    completed_codes = {normalize_text(item.get("experiment_code") or item.get("experiment_no")) for item in as_list(snapshot["experiments"]) if normalize_text(item.get("task_code") or item.get("task_no")) == task_code(task) and normalize_text(item.get("experiment_code") or item.get("experiment_no")) in axis_codes and normalize_experiment_status_text(item.get("status") or item.get("experiment_status")) in {"实验已完成", "实验完成", "实验已经完成"}}
    if target_type == "staging":
        axis_done = bool(axis_codes) and axis_codes.issubset(completed_codes)
        post_done = partial_axis_batch_completed or axis_done
        if not axis_codes:
            post_done = post_done or tray_assigned_experiments_are_completed(
                task_code=task_code(task),
                tray_code=tray_code,
                experiment_trays=snapshot["experiment_trays"],
                experiment_run_trays=snapshot["experiment_run_trays"],
            )
        appearance_to_staging = current_status == APPEARANCE_STORED_STATUS
        if current_status in TRAY_OUTBOUND_STATUSES and not (post_done or appearance_to_staging):
            raise HTTPException(status_code=400, detail="该托盘已送往目标位置，请勿重复操作")
        next_status, next_location, detail = "送至暂存间", STAGING_LOCATION, normalize_text(tray_code)
    elif target_type == "lab":
        payload = serialize_dispatch(snapshot, task, tray_code)
        matched = next(
            (
                item
                for item in payload["destinations"]
                if item["targetType"] == "lab"
                and normalize_text(item.get("targetName")) == target_name
                and normalize_text(item.get("experimentCode")) == normalize_text(request.experiment_code)
                and normalize_text(item.get("scheduleId")) == normalize_text(request.schedule_id)
                and normalize_text(item.get("subExperimentCode")) == normalize_text(request.sub_experiment_code)
                and normalize_text(item.get("axisBatchNo")) == normalize_text(request.axis_batch_no)
                and bool(item.get("scheduled"))
            ),
            None,
        )
        if matched is None:
            raise HTTPException(status_code=409, detail="只能执行当前排程顺序中的下一实验，请刷新后重试")
        unavailable = find_unavailable_device(snapshot, target_name)
        if unavailable:
            raise HTTPException(status_code=400, detail=f"{normalize_text(unavailable.get('code')) or target_name}设备维修中，禁止送至该实验室")
        if current_status in TRAY_OUTBOUND_STATUSES and current_status not in TRAY_LAB_REDISPATCH_STATUSES and not partial_axis_batch_completed:
            raise HTTPException(status_code=400, detail="该托盘已送往目标位置，请勿重复操作")
        next_status, next_location, detail = "送至实验室", target_name, f"{normalize_text(tray_code)} -> {target_name}"
    else:
        raise HTTPException(status_code=400, detail="请选择有效的目标位置")
    timestamp = now_business_text()
    dispatched_from_pre_appearance = target_type == "lab" and current_status == PRE_EXPERIMENT_APPEARANCE_STATUS
    for sample in tray_samples:
        sample["location"] = next_location
        sample["status"] = next_status
        sample["flow_status"] = next_status
        sample["updated_at"] = timestamp
        next_trays = []
        for entry in as_list(sample.get("trays")):
            item = dict(entry)
            if normalize_text(item.get("tray_code")) == normalize_text(tray_code):
                item["status"] = next_status
                item["updated_at"] = timestamp
                clear_fixture_ready_marker(item)
                if target_type == "lab":
                    item["target_lab"] = normalize_text(matched.get("targetName"))
                    item["target_lab_code"] = normalize_text(matched.get("targetLabCode"))
                    item["target_lab_id"] = matched.get("targetLabId", "")
                    item["target_experiment_code"] = normalize_text(matched.get("experimentCode"))
                    item["target_schedule_id"] = normalize_text(matched.get("scheduleId"))
                    item["target_sub_experiment_code"] = normalize_text(matched.get("subExperimentCode"))
                    item["target_axis_batch_no"] = normalize_text(matched.get("axisBatchNo"))
                else:
                    for key in (
                        "target_lab",
                        "target_lab_code",
                        "target_lab_id",
                        "target_experiment_code",
                        "target_schedule_id",
                        "target_sub_experiment_code",
                        "target_axis_batch_no",
                    ):
                        item.pop(key, None)
            next_trays.append(item)
        sample["trays"] = next_trays
        append_history(sample, next_status, detail)
    if dispatched_from_pre_appearance:
        normalized = normalize_text(tray_code)
        snapshot["staging_events"].append({"id": f"staging-event-{normalized}-{len(snapshot['staging_events']) + 1}", "tray_code": normalized, "task_code": task_code(task), "room": APPEARANCE_EVENT_ROOM, "action": APPEARANCE_STOCK_OUT_ACTION, "target_lab": target_name, "target_experiment_code": normalize_text(matched.get("experimentCode")), "target_schedule_id": normalize_text(matched.get("scheduleId")), "target_sub_experiment_code": normalize_text(matched.get("subExperimentCode")), "target_axis_batch_no": normalize_text(matched.get("axisBatchNo")), "target_type": "lab", "time": timestamp})
    write_snapshot(snapshot, update_source=update_source, update_request_id=update_request_id)
    return {"message": f"{normalize_text(tray_code)}已标记为{next_status}", "affectedSampleCount": len(tray_samples)}


def apply_task_allocation(snapshot: dict[str, list[dict[str, Any]]], task: dict[str, Any], task_samples: list[dict[str, Any]], request: Any, *, max_assignable_count: int) -> None:
    sample_map = {sample_key(sample): sample for sample in task_samples}
    requested_ids = [sample_id for tray in request.trays for sample_id in tray.sample_ids]
    requested_tray_count = sum(1 for tray in request.trays if tray.sample_ids)
    if sorted(requested_ids) != sorted(sample_map.keys()):
        raise HTTPException(status_code=400, detail="所有任务样品必须且只能分配到一个托盘中")
    if len(set(requested_ids)) != len(requested_ids):
        raise HTTPException(status_code=400, detail="样品不能重复分配到多个托盘")
    if requested_tray_count > max_assignable_count:
        raise HTTPException(status_code=400, detail=f"系统剩余托盘不足，当前最多可分配 {max_assignable_count} 个托盘。")
    loaded_tray_ids = {tray.tray_id for tray in request.trays if tray.sample_ids}
    codes = task_experiment_code_set(task, snapshot["experiments"])
    if codes:
        refs: dict[str, set[int]] = {}
        for selection in request.experiment_trays:
            code = normalize_text(selection.experiment_code)
            if code:
                if code in refs:
                    raise HTTPException(status_code=400, detail="实验托盘分配信息不完整")
                refs[code] = set(selection.tray_ids)
        validate_complete_experiment_tray_refs(codes, loaded_tray_ids, refs)
    for sample in task_samples:
        clear_transfer_history(sample)
        sample["trays"] = []
    update_task_samples_for_pending(task, task_samples)
    next_experiment_trays = [entry for entry in snapshot["experiment_trays"] if normalize_text(entry.get("task_code")) != task_code(task)]
    next_experiment_samples = [entry for entry in snapshot["experiment_samples"] if normalize_text(entry.get("task_code")) != task_code(task)]
    for key in ("experiment_runs", "experiment_run_trays"):
        snapshot[key] = [entry for entry in snapshot[key] if normalize_text(entry.get("task_code")) != task_code(task)]
    tray_codes: list[str] = []
    tray_code_by_id: dict[int, str] = {}
    tray_samples_by_code: dict[str, list[str]] = {}
    for tray in request.trays:
        if len(tray.sample_ids) > request.tray_limit:
            raise HTTPException(status_code=400, detail="单托盘样品数量超过统一上限")
        _serial, tray_no = decode_tray_id(task_code(task), tray.tray_id)
        tray_code_by_id[tray.tray_id] = tray_no
        tray_samples_by_code[tray_no] = []
        if tray.sample_ids:
            tray_codes.append(tray_no)
        for sample_id in tray.sample_ids:
            if sample_id not in sample_map:
                raise HTTPException(status_code=400, detail="存在不属于当前任务的样品")
            sample_value = sample_map[sample_id]
            tray_samples_by_code[tray_no].append(sample_code(sample_value))
            sample_value["trays"].append({"tray_id": tray.tray_id, "tray_code": tray_no, "tray_type": "标准托盘", "quantity": 1, "status": TASK_STATUS_PENDING, "barcode_id": None, "barcode_no": None, "barcode_content": None, "barcode_type": None, "printed_at": None})
            append_history(sample_value, "样品分装托盘", tray_no)
    for selection in request.experiment_trays:
        code = normalize_text(selection.experiment_code)
        if not code:
            continue
        experiment_samples: set[str] = set()
        for tray_id in selection.tray_ids:
            tray_no = tray_code_by_id.get(tray_id)
            if not tray_no:
                continue
            next_experiment_trays.append({"task_code": task_code(task), "experiment_code": code, "tray_code": tray_no})
            experiment_samples.update(value for value in tray_samples_by_code.get(tray_no, []) if value)
        next_experiment_samples.extend({"task_code": task_code(task), "experiment_code": code, "sample_code": value} for value in sorted(experiment_samples))
    task["tray_limit"] = request.tray_limit
    task["tray_codes"] = sorted(set(tray_codes))
    task["transfer_status"] = TASK_STATUS_PENDING
    task["updated_at"] = now_business_text()
    snapshot["experiment_trays"] = next_experiment_trays
    snapshot["experiment_samples"] = next_experiment_samples


def apply_confirm_storage(snapshot: dict[str, list[dict[str, Any]]], task: dict[str, Any], task_samples: list[dict[str, Any]]) -> None:
    task["transfer_status"] = TASK_STATUS_STORED
    now_iso = now_business_text()
    if not normalize_text(task.get("arrival_at") or task.get("receivedTime")):
        task["arrival_at"] = now_iso
    task["updated_at"] = now_iso
    for sample in task_samples:
        sample["location"] = HANDOVER_LOCATION
        sample["status"] = TASK_STATUS_STORED
        sample["flow_status"] = TASK_STATUS_STORED
        sample["trays"] = [{**dict(entry), "status": TASK_STATUS_STORED} for entry in as_list(sample.get("trays"))]
        append_history(sample, "任务已确认入库", task_code(task))
    task_code_value = task_code(task)
    for experiment in snapshot["experiments"]:
        if normalize_text(experiment.get("task_code")) != task_code_value:
            continue
        experiment_code_value = normalize_text(experiment.get("experiment_code"))
        if experiment_code_value:
            experiment["unscheduled_since"] = "" if has_formal_schedule(snapshot, task_code_value, experiment_code_value) else now_iso


def apply_reload(snapshot: dict[str, list[dict[str, Any]]], task: dict[str, Any], task_samples: list[dict[str, Any]]) -> bool:
    code = task_code(task)
    for key in ("experiment_trays", "experiment_samples", "experiment_runs", "experiment_run_trays"):
        snapshot[key] = [entry for entry in snapshot[key] if normalize_text(entry.get("task_code")) != code]
    task["transfer_status"] = TASK_STATUS_PENDING
    task["tray_codes"] = []
    task["updated_at"] = now_business_text()
    update_task_samples_for_pending(task, task_samples)
    for sample in task_samples:
        sample["trays"] = []
        append_history(sample, "任务重新入库", code)
    return reset_task_schedules_for_reschedule(snapshot, code)
