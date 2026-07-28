from __future__ import annotations

import math
from datetime import datetime
from typing import Any

from fastapi import HTTPException

from app.api.routes.transfer_area_commands import (
    STOCK_TRAY_CODE_PATTERN,
    STOCK_TRAY_ID_BASE,
    STAGING_LOCATION,
    TASK_STATUS_PENDING,
    TASK_STATUS_STORED,
    TASK_TRAY_ID_BASE,
    TRANSFER_HISTORY_ACTIONS,
    TRAY_CODE_PATTERN,
    TRAY_OUTBOUND_STATUSES,
    TRAY_QR_PREFIX,
    normalize_tray_scan_code,
)
from app.api.routes.transfer_area_schemas import DEFAULT_TRAY_LIMIT, MAX_TRAY_LIMIT, TRAY_QR_TYPE
from app.api.routes.transfer_area_views import (
    as_list,
    build_experiment_summary,
    build_sample_experiment_map,
    experiment_type_label,
    normalize_text,
    sample_code,
    sample_key,
    sample_sort_key,
    sample_task_code,
    task_code,
    task_key,
)
from app.core.storage_backend import normalize_experiment_status_text
from app.core.time_utils import parse_business_datetime
from app.services.appearance_inspection import (
    PRE_EXPERIMENT_APPEARANCE_STATUS,
    experiment_requires_appearance_inspection,
)

TASK_STATUS_RETURNED = "厂家收回"
RETURNED_REENTRY_BLOCK_REASON = "该任务已厂家收回，不能重新入库。"
TRAY_STATUS_ASSIGNED = "已预分配"
TRAY_STATUS_PENDING = "待入库"
TRAY_STATUS_STORED = "到货"
TRANSFER_OVERVIEW_SAMPLE_CODE_LIMIT = 12
SYSTEM_TRAY_TOTAL = 50
SCHEDULE_RESET_WARNING = "当前任务已有排程，重新分配/重新入库后将清空排程信息，需要重新排程。"
POST_EXPERIMENT_STAGING_SENT_STATUS = "送至暂存间"
POST_EXPERIMENT_STAGING_STOCKED_STATUS = "实验后暂存间存放"
EXCLUDED_TASK_STATUS_KEYWORDS = (
    "实验中",
    "实验进行中",
    "实验完成",
    "实验已经完成",
    "实验已完成",
    "任务进行中",
    "任务完成",
    "任务已完成",
    "厂家收回",
)
STARTED_EXPERIMENT_TRAY_STATUSES = (
    "实验进行中",
    "实验中",
    "实验已完成",
    "实验完成",
    "实验已经完成",
    POST_EXPERIMENT_STAGING_STOCKED_STATUS,
    "送至外观检测间",
    "实验后外观检测间存放",
    "厂家收回",
)
RELOAD_BLOCKED_OUTBOUND_TRAY_STATUSES = {
    "送至暂存间",
    POST_EXPERIMENT_STAGING_SENT_STATUS,
    "已到达暂存间",
    "送至实验室",
    "已到达实验室",
    "工装夹具安装",
    "实验准备就绪",
    PRE_EXPERIMENT_APPEARANCE_STATUS,
}
STORED_OR_DISPATCHED_SAMPLE_STATUSES = {
    TASK_STATUS_STORED,
    *TRAY_OUTBOUND_STATUSES,
    *STARTED_EXPERIMENT_TRAY_STATUSES,
}



def is_handover_stored_status(value: Any) -> bool:
    return normalize_text(value) == TASK_STATUS_STORED

def parse_datetime_value(value: Any) -> datetime | None:
    return parse_business_datetime(value)

def schedule_is_completed(schedule: dict[str, Any]) -> bool:
    return normalize_experiment_status_text(schedule.get("status")) in {"实验已完成", "实验完成", "实验已经完成"}

def task_has_schedule(snapshot: dict[str, list[dict[str, Any]]], task_code_value: str) -> bool:
    normalized_task_code = normalize_text(task_code_value)
    return any(
        normalize_text(schedule.get("task_code") or schedule.get("taskCode")) == normalized_task_code
        for schedule in as_list(snapshot.get("schedules"))
        if isinstance(schedule, dict)
    )

def parse_positive_int(value: Any) -> int:
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return 0
    return parsed if parsed > 0 else 0

def sample_has_transfer_work(sample: dict[str, Any]) -> bool:
    if as_list(sample.get("trays")):
        return True
    status_text = normalize_text(sample.get("status") or sample.get("flow_status"))
    if status_text in STORED_OR_DISPATCHED_SAMPLE_STATUSES:
        return True
    return any(normalize_text(entry.get("action")) in TRANSFER_HISTORY_ACTIONS for entry in as_list(sample.get("history")))

def build_task_sample_map(samples: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    for sample in samples:
        result.setdefault(sample_task_code(sample), []).append(sample)
    for entries in result.values():
        entries.sort(key=sample_sort_key)
    return result

def is_visible_task(task: dict[str, Any], task_samples: list[dict[str, Any]]) -> bool:
    if normalize_text(task.get("transfer_status")) == TASK_STATUS_RETURNED:
        return False
    status_text = " ".join(
        [
            normalize_text(task.get("status")),
            normalize_text(task.get("displayStatus")),
            normalize_text(task.get("display_status")),
        ]
    )
    if any(keyword in status_text for keyword in EXCLUDED_TASK_STATUS_KEYWORDS):
        return is_handover_stored_status(transfer_status_for_task(task, task_samples))
    return bool(task_samples) or bool(normalize_text(task.get("sample_count")))



def started_experiment_status_for_task(task_samples: list[dict[str, Any]]) -> str:
    matched_statuses: list[str] = []
    for sample in task_samples:
        sample_status = normalize_experiment_status_text(sample.get("status"))
        if sample_status in STARTED_EXPERIMENT_TRAY_STATUSES:
            matched_statuses.append(sample_status)
        for entry in as_list(sample.get("trays")):
            tray_status = normalize_experiment_status_text(entry.get("status"))
            if tray_status in STARTED_EXPERIMENT_TRAY_STATUSES:
                matched_statuses.append(tray_status)

    priority = {
        "实验进行中": 0,
        "实验已完成": 1,
        POST_EXPERIMENT_STAGING_STOCKED_STATUS: 2,
        "厂家收回": 3,
    }
    normalized_statuses = sorted(
        {status for status in matched_statuses if status},
        key=lambda status: (priority.get(status, 99), status),
    )
    return normalized_statuses[0] if normalized_statuses else ""

def outbound_status_for_task(task_samples: list[dict[str, Any]]) -> str:
    matched_statuses: list[str] = []
    for sample in task_samples:
        for status in (sample.get("status"), sample.get("flow_status")):
            normalized_status = normalize_experiment_status_text(status)
            if normalized_status in RELOAD_BLOCKED_OUTBOUND_TRAY_STATUSES:
                matched_statuses.append(normalized_status)
        for entry in as_list(sample.get("trays")):
            tray_status = normalize_experiment_status_text(entry.get("status"))
            if tray_status in RELOAD_BLOCKED_OUTBOUND_TRAY_STATUSES:
                matched_statuses.append(tray_status)
    return sorted({status for status in matched_statuses if status})[0] if matched_statuses else ""

def is_returned_task(task: dict[str, Any], task_samples: list[dict[str, Any]]) -> bool:
    return normalize_text(task.get("transfer_status")) == TASK_STATUS_RETURNED

def returned_task_block_reason(task: dict[str, Any], task_samples: list[dict[str, Any]]) -> str:
    return RETURNED_REENTRY_BLOCK_REASON if is_returned_task(task, task_samples) else ""

def reload_block_reason(task_samples: list[dict[str, Any]], task: dict[str, Any] | None = None) -> str:
    if task is not None:
        current_returned_reason = returned_task_block_reason(task, task_samples)
        if current_returned_reason:
            return current_returned_reason
    if started_experiment_status_for_task(task_samples):
        return "该任务已有托盘开始实验，不能重新入库。"
    return "该任务已有托盘离开接驳区，不能重新入库。" if outbound_status_for_task(task_samples) else ""

def ensure_task_not_returned(task: dict[str, Any], task_samples: list[dict[str, Any]]) -> None:
    current_returned_reason = returned_task_block_reason(task, task_samples)
    if current_returned_reason:
        raise HTTPException(status_code=400, detail=current_returned_reason)

def transfer_status_for_task(task: dict[str, Any], task_samples: list[dict[str, Any]]) -> str:
    explicit = normalize_text(task.get("transfer_status"))
    if explicit == TASK_STATUS_RETURNED:
        return TASK_STATUS_RETURNED
    if is_handover_stored_status(explicit):
        return TASK_STATUS_STORED
    if explicit == TASK_STATUS_PENDING:
        return TASK_STATUS_PENDING
    return TASK_STATUS_PENDING

def task_tray_limit(task: dict[str, Any]) -> int:
    raw = task.get("tray_limit")
    try:
        parsed = int(str(raw).strip())
    except (TypeError, ValueError):
        parsed = 0
    if parsed <= 0:
        return DEFAULT_TRAY_LIMIT
    return min(parsed, MAX_TRAY_LIMIT)

def task_arrival_time(task: dict[str, Any]) -> str:
    return normalize_text(task.get("arrival_at") or task.get("receivedTime"))

def has_saved_allocation(task_samples: list[dict[str, Any]]) -> bool:
    return bool(task_samples) and all(as_list(sample.get("trays")) for sample in task_samples)



def encode_task_tray_id(serial: int) -> int:
    return TASK_TRAY_ID_BASE + serial

def encode_stock_tray_id(serial: int) -> int:
    return STOCK_TRAY_ID_BASE + serial

def tray_serial_from_code(tray_code: str) -> int:
    stock_match = STOCK_TRAY_CODE_PATTERN.match(tray_code)
    if stock_match:
        return int(stock_match.group(1))
    task_match = TRAY_CODE_PATTERN.search(tray_code)
    if task_match:
        return int(task_match.group(1))
    return 0

def encode_tray_id(tray_code: str, fallback_serial: int) -> int:
    normalized = normalize_text(tray_code)
    serial = tray_serial_from_code(normalized) or fallback_serial
    if STOCK_TRAY_CODE_PATTERN.match(normalized):
        return encode_stock_tray_id(serial)
    return encode_task_tray_id(serial)

def build_tray_qr_content(tray_code_value: str) -> str:
    normalized = normalize_text(tray_code_value)
    return f"{TRAY_QR_PREFIX}{normalized}" if normalized else ""

def build_barcode_payload(tray_code_value: str, sample_count: int, barcode_id: int | None = None) -> dict[str, Any]:
    return {
        "barcodeId": barcode_id or max(9000, 9000 + tray_serial_from_code(tray_code_value)),
        "barcodeNo": tray_code_value,
        "barcodeContent": build_tray_qr_content(tray_code_value),
    }

def serialize_sample(sample: dict[str, Any], task_status: str, experiment_codes: list[str] | None = None) -> dict[str, Any]:
    return {
        "sampleId": sample_key(sample),
        "sampleNo": sample_code(sample),
        "sampleStatus": TASK_STATUS_STORED if task_status == TASK_STATUS_STORED else TASK_STATUS_PENDING,
        "experimentCodes": list(experiment_codes or []),
    }



def build_assigned_trays(
    task: dict[str, Any],
    task_samples: list[dict[str, Any]],
    task_status: str,
    sample_experiment_map: dict[str, list[str]] | None = None,
) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    ordered_codes: list[str] = []
    normalized_sample_experiment_map = sample_experiment_map or {}

    for sample in task_samples:
        trays = as_list(sample.get("trays"))
        if not trays:
            continue
        tray = dict(trays[0])
        tray_code_value = normalize_text(tray.get("tray_code"))
        if not tray_code_value:
            continue
        if tray_code_value not in grouped:
            tray_id = tray.get("tray_id")
            try:
                normalized_tray_id = int(tray_id)
            except (TypeError, ValueError):
                normalized_tray_id = encode_tray_id(tray_code_value, len(grouped) + 1)
            barcode = None
            barcode_no = normalize_text(tray.get("barcode_no"))
            if barcode_no:
                barcode = {
                    **build_barcode_payload(
                        barcode_no,
                        0,
                        barcode_id=int(tray.get("barcode_id") or encode_tray_id(barcode_no, len(grouped) + 1)),
                    ),
                    "objectId": normalized_tray_id,
                }
            grouped[tray_code_value] = {
                "trayId": normalized_tray_id,
                "trayNo": tray_code_value,
                "trayType": normalize_text(tray.get("tray_type")) or "标准托盘",
                "trayStatus": TRAY_STATUS_STORED if task_status == TASK_STATUS_STORED else (TRAY_STATUS_PENDING if barcode else TRAY_STATUS_ASSIGNED),
                "capacity": task_tray_limit(task),
                "loadQty": 0,
                "samples": [],
                "barcode": barcode,
                "barcodeData": barcode["barcodeContent"] if barcode else None,
            }
            ordered_codes.append(tray_code_value)
        grouped[tray_code_value]["samples"].append(
            serialize_sample(sample, task_status, normalized_sample_experiment_map.get(sample_code(sample), []))
        )

    if grouped:
        trays = [grouped[tray_code] for tray_code in sorted(ordered_codes, key=tray_serial_from_code)]
        for tray in trays:
            tray["loadQty"] = len(tray["samples"])
            if tray["barcode"]:
                tray["barcode"]["barcodeType"] = TRAY_QR_TYPE
                tray["barcode"]["barcodeContent"] = build_tray_qr_content(tray["trayNo"])
                tray["barcodeData"] = tray["barcode"]["barcodeContent"]
        return trays

    limit = task_tray_limit(task)
    tray_count = max(1, math.ceil(len(task_samples) / limit)) if task_samples else 1
    trays = []
    for index in range(tray_count):
        start = index * limit
        end = start + limit
        tray_samples = [
            serialize_sample(sample, task_status, normalized_sample_experiment_map.get(sample_code(sample), []))
            for sample in task_samples[start:end]
        ]
        tray_no = f"{task_code(task)}-TP-{index + 1:03d}"
        trays.append(
            {
                "trayId": encode_task_tray_id(index + 1),
                "trayNo": tray_no,
                "trayType": "标准托盘",
                "trayStatus": TRAY_STATUS_ASSIGNED,
                "capacity": limit,
                "loadQty": len(tray_samples),
                "samples": tray_samples,
                "barcode": None,
                "barcodeData": None,
            }
        )
    return trays



def serialize_tray_dispatch_payload(snapshot: dict[str, list[dict[str, Any]]], task: dict[str, Any], tray_code: str) -> dict[str, Any]:
    task_samples = build_task_sample_map(snapshot["samples"]).get(task_code(task), [])
    workspace = serialize_workspace(
        task,
        task_samples,
        snapshot["samples"],
        snapshot["experiments"],
        snapshot["experiment_trays"],
        snapshot["experiment_samples"],
        snapshot["schedules"],
    )
    tray = next(
        (item for item in workspace["assignedTrays"] if normalize_text(item.get("trayNo")) == normalize_text(tray_code)),
        None,
    )
    if tray is None:
        raise HTTPException(status_code=404, detail="未找到托盘")

    actual_tray_status = normalize_text(tray.get("trayStatus"))
    actual_tray_target_lab = ""
    actual_tray_location = ""
    for sample in task_samples:
        for entry in as_list(sample.get("trays")):
            if normalize_text(entry.get("tray_code")) == normalize_text(tray_code):
                actual_tray_status = normalize_text(entry.get("status")) or actual_tray_status
                actual_tray_target_lab = normalize_text(entry.get("target_lab") or entry.get("targetLab")) or actual_tray_target_lab
                actual_tray_location = normalize_text(sample.get("location")) or actual_tray_location
                break
        if actual_tray_status and actual_tray_status != normalize_text(tray.get("trayStatus")):
            break
    tray_display_status = actual_tray_status
    if actual_tray_status == "送至实验室":
        tray_display_status = actual_tray_target_lab or actual_tray_location or actual_tray_status

    return {
        "tray": {
            "trayNo": tray["trayNo"],
            "trayStatus": actual_tray_status,
            "trayDisplayStatus": tray_display_status,
            "targetLab": actual_tray_target_lab,
            "taskNo": task_code(task),
            "taskName": normalize_text(task.get("name")),
            "sampleCount": len(tray.get("samples") or []),
            "experimentLabels": list(tray.get("experimentLabels") or []),
            "experimentCodes": list(tray.get("experimentCodes") or []),
        },
        "destinations": build_tray_dispatch_destinations(
            task,
            tray,
            snapshot["experiments"],
            snapshot["experiment_trays"],
            snapshot["schedules"],
            actual_tray_status,
        ),
    }



def find_task(snapshot: dict[str, list[dict[str, Any]]], task_id: str) -> dict[str, Any]:
    normalized = normalize_text(task_id)
    for task in snapshot["tasks"]:
        if task_key(task) == normalized or task_code(task) == normalized:
            return task
    raise HTTPException(status_code=404, detail="未找到任务")

def find_tray_samples(snapshot: dict[str, list[dict[str, Any]]], tray_code_value: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    normalized_tray_code = normalize_tray_scan_code(tray_code_value)
    matched_samples = [
        sample
        for sample in snapshot["samples"]
        if any(normalize_text(entry.get("tray_code")) == normalized_tray_code for entry in as_list(sample.get("trays")))
    ]
    if not matched_samples:
        raise HTTPException(status_code=404, detail="未找到托盘")

    task_codes = {sample_task_code(sample) for sample in matched_samples if sample_task_code(sample)}
    if len(task_codes) != 1:
        raise HTTPException(status_code=400, detail="托盘关联任务异常")
    return find_task(snapshot, next(iter(task_codes))), matched_samples

def build_tray_dispatch_destinations(
    task: dict[str, Any],
    tray: dict[str, Any],
    experiments: list[dict[str, Any]],
    experiment_trays: list[dict[str, Any]],
    schedules: list[dict[str, Any]],
    current_tray_status: str = "",
) -> list[dict[str, Any]]:
    task_experiments = [
        row for row in build_task_experiment_rows(task, experiments, experiment_trays)
        if tray["trayNo"] in row["assignedTrayNos"]
    ]
    scheduled_candidates = []
    unscheduled_candidates = []
    restrict_to_appearance_destinations = normalize_text(current_tray_status) == PRE_EXPERIMENT_APPEARANCE_STATUS

    for experiment in task_experiments:
        if restrict_to_appearance_destinations and not experiment_requires_appearance_inspection(
            experiment.get("experimentName"),
            {
                "experiment_name": experiment.get("experimentName"),
                "required_device": experiment.get("requiredDevice"),
            },
        ):
            continue
        matching_schedules = [
            entry for entry in schedules
            if normalize_text(entry.get("task_code")) == task_code(task)
            and normalize_text(entry.get("experiment_code")) == experiment["experimentCode"]
            and normalize_text(entry.get("device"))
        ]
        matching_schedules = [entry for entry in matching_schedules if not schedule_is_completed(entry)]
        matching_schedules.sort(
            key=lambda item: (
                parse_datetime_value(item.get("start_at")) or datetime.max,
                normalize_text(item.get("device")),
            )
        )

        if matching_schedules:
            schedule = matching_schedules[0]
            scheduled_candidates.append(
                {
                    "targetType": "lab",
                    "targetName": normalize_text(schedule.get("device")),
                    "experimentCode": experiment["experimentCode"],
                    "experimentName": experiment["experimentName"],
                    "scheduled": True,
                    "preferred": False,
                    "scheduleStartAt": normalize_text(schedule.get("start_at")),
                    "scheduleEndAt": normalize_text(schedule.get("end_at")),
                }
            )
            continue

        experiment_label = normalize_text(experiment.get("experimentName")) or normalize_text(experiment.get("requiredDevice"))
        unscheduled_candidates.append(
            {
                "targetType": "lab",
                "targetName": f"{experiment_label}（待排程）",
                "experimentCode": experiment["experimentCode"],
                "experimentName": experiment["experimentName"],
                "scheduled": False,
                "preferred": False,
                "scheduleStartAt": "",
                "scheduleEndAt": "",
            }
        )

    scheduled_candidates.sort(
        key=lambda item: (
            parse_datetime_value(item.get("scheduleStartAt")) or datetime.max,
            normalize_text(item.get("targetName")),
        )
    )
    if len(scheduled_candidates) >= 1:
        earliest = parse_datetime_value(scheduled_candidates[0].get("scheduleStartAt"))
        if earliest is not None:
            earliest_count = sum(
                1
                for item in scheduled_candidates
                if parse_datetime_value(item.get("scheduleStartAt")) == earliest
            )
            if earliest_count == 1:
                scheduled_candidates[0]["preferred"] = True

    return [
        {
            "targetType": "staging",
            "targetName": STAGING_LOCATION,
            "experimentCode": "",
            "experimentName": "暂存间",
            "scheduled": True,
            "preferred": False,
            "scheduleStartAt": "",
            "scheduleEndAt": "",
        },
        *scheduled_candidates,
        *unscheduled_candidates,
    ]



def serialize_workspace(
    task: dict[str, Any],
    task_samples: list[dict[str, Any]],
    all_samples: list[dict[str, Any]] | None = None,
    experiments: list[dict[str, Any]] | None = None,
    experiment_trays: list[dict[str, Any]] | None = None,
    experiment_samples: list[dict[str, Any]] | None = None,
    schedules: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    current_task_status = transfer_status_for_task(task, task_samples)
    sample_experiment_map = build_sample_experiment_map(
        task,
        task_samples,
        experiment_trays or [],
        experiment_samples or [],
    )
    assigned_trays = build_assigned_trays(task, task_samples, current_task_status, sample_experiment_map)
    task_experiments = build_task_experiment_rows(task, experiments or [], experiment_trays or [])
    experiment_summary = build_experiment_summary(task, experiments or [])
    tray_experiment_labels = build_tray_experiment_labels(task, experiments or [], experiment_trays or [])
    assigned_trays = [
        {
            **tray,
            "experimentLabels": tray_experiment_labels.get(tray["trayNo"], []),
            "experimentCodes": [
                experiment["experimentCode"]
                for experiment in task_experiments
                if tray["trayNo"] in experiment["assignedTrayNos"]
            ],
        }
        for tray in assigned_trays
    ]
    current_progress = task_progress(task, current_task_status, assigned_trays, task_samples, experiments or [])
    printed_tray_count = sum(1 for tray in assigned_trays if tray["barcode"])
    global_samples = all_samples if all_samples is not None else task_samples
    max_assignable_count = max_assignable_tray_count(global_samples, task_samples)
    required_tray_count = sum(1 for tray in assigned_trays if tray["samples"])
    tray_capacity_exceeded = required_tray_count > max_assignable_count
    current_reload_block_reason = reload_block_reason(task_samples, task)
    has_schedules = task_has_schedule({"schedules": schedules or []}, task_code(task))
    tray_capacity_message = (
        f"系统剩余托盘不足，当前最多可分配 {max_assignable_count} 个托盘。"
        if tray_capacity_exceeded
        else ""
    )
    return {
        "task": {
            "taskId": task_key(task),
            "taskNo": task_code(task),
            "taskName": normalize_text(task.get("name")),
            "taskType": normalize_text(task.get("test_type")),
            "experimentTypeText": experiment_summary or normalize_text(task.get("test_type")),
            "taskStatus": current_task_status,
            "taskProgress": current_progress,
            "receivedTime": task_arrival_time(task),
            "sampleCount": len(task_samples) or int(task.get("sample_count") or 0),
            "trayCount": len(assigned_trays),
            "printedTrayCount": printed_tray_count,
            "trayLimit": task_tray_limit(task),
            "totalTrayCount": SYSTEM_TRAY_TOTAL,
            "remainingTrayCount": max(0, SYSTEM_TRAY_TOTAL - count_system_occupied_trays(global_samples, assigned_trays)),
            "maxAssignableTrayCount": max_assignable_count,
            "requiredTrayCount": required_tray_count,
            "trayCapacityExceeded": tray_capacity_exceeded,
            "trayCapacityMessage": tray_capacity_message,
            "reloadBlocked": bool(current_reload_block_reason),
            "reloadBlockedReason": current_reload_block_reason,
            "hasSchedules": has_schedules,
            "scheduleResetWarning": SCHEDULE_RESET_WARNING if has_schedules else "",
        },
        "assignedTrays": assigned_trays,
        "experiments": task_experiments,
        "trayInventory": build_inventory_trays(assigned_trays, task_tray_limit(task), global_samples),
        "allocationSaved": has_saved_allocation(task_samples),
    }

def build_overview_tray_progress_rows(task_samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    ordered_codes: list[str] = []
    for sample in task_samples:
        trays = as_list(sample.get("trays"))
        if not trays:
            continue
        tray = dict(trays[0])
        tray_code_value = normalize_text(tray.get("tray_code"))
        if not tray_code_value:
            continue
        if tray_code_value not in grouped:
            grouped[tray_code_value] = {
                "samples": [],
                "barcode": bool(normalize_text(tray.get("barcode_no")) or normalize_text(tray.get("printed_at"))),
            }
            ordered_codes.append(tray_code_value)
        grouped[tray_code_value]["samples"].append(True)
    return [grouped[tray_code_value] for tray_code_value in sorted(ordered_codes, key=tray_serial_from_code)]

def build_transfer_overview_row(
    task: dict[str, Any],
    task_samples: list[dict[str, Any]],
    experiments: list[dict[str, Any]],
    seq: int,
) -> dict[str, Any]:
    current_task_status = transfer_status_for_task(task, task_samples)
    assigned_tray_rows = build_overview_tray_progress_rows(task_samples)
    experiment_summary = build_experiment_summary(task, experiments)
    sample_codes = [sample_code(sample) for sample in task_samples if sample_code(sample)]
    return {
        "seq": seq,
        "taskId": task_key(task),
        "taskNo": task_code(task),
        "taskName": normalize_text(task.get("name")),
        "taskType": normalize_text(task.get("test_type")),
        "experimentTypeText": experiment_summary or normalize_text(task.get("test_type")),
        "sampleCount": len(task_samples) or int(task.get("sample_count") or 0),
        "taskStatus": current_task_status,
        "taskProgress": task_progress(task, current_task_status, assigned_tray_rows, task_samples, experiments),
        "receivedTime": task_arrival_time(task),
        "sampleCodes": sample_codes[:TRANSFER_OVERVIEW_SAMPLE_CODE_LIMIT],
        "sampleCodePreview": sample_codes[:TRANSFER_OVERVIEW_SAMPLE_CODE_LIMIT],
        "sampleCodeSearchText": " ".join(sample_codes),
        "sampleCodesText": " / ".join(sample_codes[:TRANSFER_OVERVIEW_SAMPLE_CODE_LIMIT]),
        "sampleCodeCount": len(sample_codes),
    }



def build_task_experiment_rows(
    task: dict[str, Any],
    experiments: list[dict[str, Any]],
    experiment_trays: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    task_code_value = task_code(task)
    tray_map: dict[str, list[str]] = {}
    for entry in experiment_trays:
        if normalize_text(entry.get("task_code")) != task_code_value:
            continue
        experiment_code = normalize_text(entry.get("experiment_code"))
        tray_code = normalize_text(entry.get("tray_code"))
        if not experiment_code or not tray_code:
            continue
        tray_map.setdefault(experiment_code, [])
        if tray_code not in tray_map[experiment_code]:
            tray_map[experiment_code].append(tray_code)

    rows = []
    for experiment in experiments:
        if normalize_text(experiment.get("task_code")) != task_code_value:
            continue
        experiment_code = normalize_text(experiment.get("experiment_code"))
        assigned_tray_nos = sorted(tray_map.get(experiment_code, []), key=tray_serial_from_code)
        rows.append(
            {
                "experimentCode": experiment_code,
                "experimentName": experiment_type_label(experiment),
                "requiredDevice": normalize_text(experiment.get("required_device")),
                "assignedTrayNos": assigned_tray_nos,
                "assignedTrayCount": len(assigned_tray_nos),
            }
        )
    return rows

def build_tray_experiment_labels(
    task: dict[str, Any],
    experiments: list[dict[str, Any]],
    experiment_trays: list[dict[str, Any]],
) -> dict[str, list[str]]:
    experiment_name_map = {
        normalize_text(experiment.get("experiment_code")): experiment_type_label(experiment)
        for experiment in experiments
        if normalize_text(experiment.get("task_code")) == task_code(task)
    }
    tray_labels: dict[str, list[str]] = {}
    for entry in experiment_trays:
        if normalize_text(entry.get("task_code")) != task_code(task):
            continue
        tray_code = normalize_text(entry.get("tray_code"))
        experiment_code = normalize_text(entry.get("experiment_code"))
        if not tray_code or not experiment_code:
            continue
        tray_labels.setdefault(tray_code, [])
        label = experiment_name_map.get(experiment_code) or experiment_code
        if label not in tray_labels[tray_code]:
            tray_labels[tray_code].append(label)
    return tray_labels

def are_task_experiments_all_completed(task: dict[str, Any], experiments: list[dict[str, Any]]) -> bool:
    task_code_value = task_code(task)
    task_experiments = [
        experiment
        for experiment in experiments
        if normalize_text(experiment.get("task_code")) == task_code_value
    ]
    if not task_experiments:
        return False

    completed_statuses = {
        "实验已完成",
        POST_EXPERIMENT_STAGING_STOCKED_STATUS,
        "厂家收回",
    }
    return all(
        normalize_experiment_status_text(experiment.get("status")) in completed_statuses
        for experiment in task_experiments
    )

def task_progress(
    task: dict[str, Any],
    task_status: str,
    assigned_trays: list[dict[str, Any]],
    task_samples: list[dict[str, Any]],
    experiments: list[dict[str, Any]],
) -> str:
    if task_status == TASK_STATUS_RETURNED:
        return TASK_STATUS_RETURNED
    started_status = started_experiment_status_for_task(task_samples)
    if started_status:
        if not are_task_experiments_all_completed(task, experiments):
            return "实验进行中"
        return started_status
    if task_status == TASK_STATUS_STORED:
        return "已确认入库"
    if not task_arrival_time(task):
        return "中控已预分配托盘，等待样品送达"
    non_empty = [tray for tray in assigned_trays if tray["samples"]]
    if non_empty and all(tray["barcode"] for tray in non_empty):
        return "二维码已打印，待确认入库"
    return "样品已送达，待打印二维码"

def count_system_occupied_trays(
    all_samples: list[dict[str, Any]],
    assigned_trays: list[dict[str, Any]] | None = None,
) -> int:
    tray_codes = {
        normalize_text(entry.get("tray_code"))
        for sample in all_samples
        for entry in as_list(sample.get("trays"))
        if normalize_text(entry.get("tray_code"))
        and normalize_text(entry.get("status") or sample.get("status")) != TASK_STATUS_RETURNED
    }
    for tray in assigned_trays or []:
        tray_code_value = normalize_text(tray.get("trayNo") or tray.get("tray_code"))
        if tray_code_value:
            tray_codes.add(tray_code_value)
    return len(tray_codes)

def count_occupied_trays_excluding_task(
    all_samples: list[dict[str, Any]],
    task_samples: list[dict[str, Any]],
) -> int:
    excluded_keys = {sample_key(sample) for sample in task_samples}
    tray_codes = {
        normalize_text(entry.get("tray_code"))
        for sample in all_samples
        if sample_key(sample) not in excluded_keys
        for entry in as_list(sample.get("trays"))
        if normalize_text(entry.get("tray_code"))
        and normalize_text(entry.get("status") or sample.get("status")) != TASK_STATUS_RETURNED
    }
    return len(tray_codes)

def max_assignable_tray_count(
    all_samples: list[dict[str, Any]],
    task_samples: list[dict[str, Any]],
) -> int:
    return max(0, SYSTEM_TRAY_TOTAL - count_occupied_trays_excluding_task(all_samples, task_samples))

def build_inventory_trays(assigned_trays: list[dict[str, Any]], capacity: int, all_samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    remaining_count = max(0, SYSTEM_TRAY_TOTAL - count_system_occupied_trays(all_samples, assigned_trays))
    trays = []
    for serial in range(1, remaining_count + 1):
        trays.append(
            {
                "trayId": encode_stock_tray_id(serial),
                "trayNo": f"STOCK-TP-{serial:03d}",
                "trayType": "标准托盘",
                "capacity": capacity,
                "currentTaskId": None,
            }
        )
    return trays
