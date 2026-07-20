from __future__ import annotations

import math
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Body, Header, HTTPException
from app.api.routes.storage import publish_storage_update, tray_has_scoped_partial_axis_batch_completion
from app.core.storage_backend import get_storage_backend, normalize_experiment_status_text, normalize_storage_payload
from app.core.time_utils import now_business_text, parse_business_datetime
from app.services.appearance_inspection import (
    PRE_EXPERIMENT_APPEARANCE_STATUS,
    experiment_requires_appearance_inspection,
)
from app.services.laboratory_operations import acquire_laboratory_storage_commit_lock
from app.services.storage_atomic import merge_concurrent_storage_updates
from app.api.routes.transfer_area_commands import (
    APPEARANCE_STORED_STATUS,
    HANDOVER_LOCATION,
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
    apply_confirm_storage,
    apply_dispatch,
    apply_reload,
    apply_task_allocation,
    apply_tray_withdrawal as apply_tray_withdrawal_command,
    ensure_tray_can_lookup_withdrawal,
    ensure_tray_currently_in_handover,
    normalize_tray_scan_code,
    tray_is_currently_stocked_in_staging,
    validate_saved_experiment_tray_allocation,
)
from app.api.routes.transfer_area_schemas import (
    DEFAULT_TRAY_LIMIT,
    MAX_TRAY_LIMIT,
    TRAY_QR_TYPE,
    ExperimentTrayAllocationPayload,
    TaskAllocationRequest,
    TrayAllocationPayload,
    TrayDispatchRequest,
    TrayPrintBarcodeRequest,
    TrayWithdrawDispatchRequest,
)
from app.api.routes.transfer_area_views import (
    as_list,
    build_experiment_summary,
    build_sample_experiment_map,
    experiment_type_label,
    normalize_text,
    sample_code,
    sample_key,
    sample_serial_sort_key,
    sample_sort_key,
    sample_task_code,
    task_code,
    task_key,
)

router = APIRouter(prefix="/api/transfer-area", tags=["transfer-area"])

TASK_STATUS_RETURNED = "厂家收回"
RETURNED_REENTRY_BLOCK_REASON = "该任务已厂家收回，不能重新入库。"
NOT_IN_HANDOVER_DISPATCH_DETAIL = "该托盘当前不在接驳区，不能从接驳区出库"
TRAY_STATUS_ASSIGNED = "已预分配"
TRAY_STATUS_PENDING = "待入库"
TRAY_STATUS_STORED = "到货"
TRANSFER_OVERVIEW_SAMPLE_CODE_LIMIT = 12
SYSTEM_TRAY_TOTAL = 10 
STAGING_STOCKED_TRANSFER_BLOCK_DETAIL = "该托盘已在暂存间入库，请从暂存间出库"
SCHEDULE_RESET_WARNING = "当前任务已有排程，重新分配/重新入库后将清空排程信息，需要重新排程。"
POST_EXPERIMENT_STAGING_SENT_STATUS = "送至暂存间"
POST_EXPERIMENT_STAGING_STOCKED_STATUS = "实验后暂存间存放"
TRANSFER_STORAGE_UPDATE_KEYS = (
    "mes.tasks",
    "mes.samples",
    "mes.schedules",
    "mes.experiments",
    "mes.experiment_runs",
    "mes.experiment_run_trays",
    "mes.experiment_run_steps",
    "mes.experiment_trays",
    "mes.experiment_samples",
    "mes.staging_events",
)
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

def now_text() -> str:
    return now_business_text(include_seconds=False)


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

def read_snapshot() -> dict[str, list[dict[str, Any]]]:
    storage = get_storage_backend()
    payload = normalize_storage_payload(storage.read_all())
    return {
        "tasks": [dict(item) for item in as_list(payload.get("mes.tasks")) if isinstance(item, dict)],
        "samples": [dict(item) for item in as_list(payload.get("mes.samples")) if isinstance(item, dict)],
        "schedules": [dict(item) for item in as_list(payload.get("mes.schedules")) if isinstance(item, dict)],
        "experiments": [dict(item) for item in as_list(payload.get("mes.experiments")) if isinstance(item, dict)],
        "experiment_runs": [dict(item) for item in as_list(payload.get("mes.experiment_runs")) if isinstance(item, dict)],
        "experiment_run_trays": [dict(item) for item in as_list(payload.get("mes.experiment_run_trays")) if isinstance(item, dict)],
        "experiment_run_steps": [dict(item) for item in as_list(payload.get("mes.experiment_run_steps")) if isinstance(item, dict)],
        "experiment_trays": [dict(item) for item in as_list(payload.get("mes.experiment_trays")) if isinstance(item, dict)],
        "experiment_samples": [dict(item) for item in as_list(payload.get("mes.experiment_samples")) if isinstance(item, dict)],
        "staging_events": [dict(item) for item in as_list(payload.get("mes.staging_events")) if isinstance(item, dict)],
        "devices": [dict(item) for item in as_list(payload.get("mes.devices")) if isinstance(item, dict)],
    }


def write_snapshot(
    snapshot: dict[str, list[dict[str, Any]]],
    *,
    replace_task_codes: set[str] | None = None,
    update_source: str = "",
    update_request_id: str = "",
) -> None:
    storage = get_storage_backend()
    updates = {
        "mes.tasks": snapshot["tasks"],
        "mes.samples": snapshot["samples"],
        "mes.schedules": snapshot["schedules"],
        "mes.experiments": snapshot["experiments"],
        "mes.experiment_runs": snapshot["experiment_runs"],
        "mes.experiment_run_trays": snapshot["experiment_run_trays"],
        "mes.experiment_run_steps": snapshot["experiment_run_steps"],
        "mes.experiment_trays": snapshot["experiment_trays"],
        "mes.experiment_samples": snapshot["experiment_samples"],
        "mes.staging_events": snapshot["staging_events"],
    }
    with acquire_laboratory_storage_commit_lock():
        storage.write_many(
            merge_concurrent_storage_updates(
                storage.read_all(),
                updates,
                replace_task_codes=replace_task_codes,
            )
        )
    source = normalize_text(update_source)
    request_id = normalize_text(update_request_id)
    if source or request_id:
        publish_storage_update(list(TRANSFER_STORAGE_UPDATE_KEYS), source=source, request_id=request_id)
    else:
        publish_storage_update(list(TRANSFER_STORAGE_UPDATE_KEYS))


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


def limit_task_samples_to_planned_count(
    snapshot: dict[str, list[dict[str, Any]]],
    task: dict[str, Any],
    task_samples: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], bool]:
    planned_count = parse_positive_int(task.get("sample_count"))
    if planned_count <= 0 or len(task_samples) <= planned_count:
        return task_samples, False

    ordered_samples = sorted(task_samples, key=sample_serial_sort_key)
    surplus_samples = ordered_samples[planned_count:]
    if any(sample_has_transfer_work(sample) for sample in surplus_samples):
        return task_samples, False

    surplus_keys = {sample_key(sample) for sample in surplus_samples}
    snapshot["samples"] = [sample for sample in snapshot["samples"] if sample_key(sample) not in surplus_keys]
    return ordered_samples[:planned_count], True


def build_task_sample_map(samples: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    for sample in samples:
        result.setdefault(sample_task_code(sample), []).append(sample)
    for entries in result.values():
        entries.sort(key=sample_sort_key)
    return result


def build_generated_task_samples(task: dict[str, Any], task_samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    task_code_value = task_code(task)
    if not task_code_value:
        return []
    planned_count = parse_positive_int(task.get("sample_count"))
    if planned_count <= 0:
        return []
    if len(task_samples) >= planned_count:
        return []

    existing_codes = {sample_code(sample) for sample in task_samples if sample_code(sample)}
    current_task_status = transfer_status_for_task(task, task_samples)
    received_time = task_arrival_time(task)
    now_iso = now_business_text()

    if is_handover_stored_status(current_task_status):
        location = "接驳区"
        status = TASK_STATUS_STORED
        flow_status = TASK_STATUS_STORED
    else:
        location = ""
        status = "运输中"
        flow_status = "运输中"

    generated = []
    for index in range(1, planned_count + 1):
        if len(task_samples) + len(generated) >= planned_count:
            break
        generated_code = f"{task_code_value}-SP-{index:03d}"
        if generated_code in existing_codes:
            continue
        generated.append(
            {
                "id": generated_code,
                "code": generated_code,
                "task_code": task_code_value,
                "sample_type": normalize_text(task.get("sample_type")),
                "batch_no": "",
                "arrival_at": received_time,
                "quantity": "1",
                "storage_condition": "",
                "barcode": "",
                "remark": "",
                "location": location,
                "owner": "",
                "status": status,
                "flow_status": flow_status,
                "created_at": now_iso,
                "updated_at": now_iso,
                "trays": [],
                "history": [],
            }
        )
    return generated


def ensure_task_samples_from_list(
    snapshot: dict[str, list[dict[str, Any]]],
    task: dict[str, Any],
    task_samples: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], bool]:
    task_samples, trimmed = limit_task_samples_to_planned_count(snapshot, task, task_samples)
    generated_samples = build_generated_task_samples(task, task_samples)
    if not generated_samples:
        return task_samples, trimmed
    snapshot["samples"].extend(generated_samples)
    refreshed_samples = sorted([*task_samples, *generated_samples], key=sample_sort_key)
    return refreshed_samples, True


def ensure_task_samples(snapshot: dict[str, list[dict[str, Any]]], task: dict[str, Any]) -> tuple[list[dict[str, Any]], bool]:
    samples_by_task = build_task_sample_map(snapshot["samples"])
    task_samples = samples_by_task.get(task_code(task), [])
    return ensure_task_samples_from_list(snapshot, task, task_samples)


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


def repair_pending_tray_codes(task: dict[str, Any], task_samples: list[dict[str, Any]]) -> bool:
    if transfer_status_for_task(task, task_samples) != TASK_STATUS_PENDING:
        return False
    if not has_saved_allocation(task_samples):
        return False

    ordered_codes = sorted(
        {
            normalize_text(as_list(sample.get("trays"))[0].get("tray_code"))
            for sample in task_samples
            if as_list(sample.get("trays")) and normalize_text(as_list(sample.get("trays"))[0].get("tray_code"))
        },
        key=tray_serial_from_code,
    )
    if not ordered_codes:
        return False

    has_any_barcode = any(
        normalize_text(entry.get("barcode_no")) or normalize_text(entry.get("printed_at"))
        for sample in task_samples
        for entry in as_list(sample.get("trays"))
    )
    if has_any_barcode:
        return False

    expected_codes = [f"{task_code(task)}-TP-{index:03d}" for index in range(1, len(ordered_codes) + 1)]
    if ordered_codes == expected_codes:
        return False

    code_map = {
        old_code: (index, new_code)
        for index, (old_code, new_code) in enumerate(zip(ordered_codes, expected_codes), start=1)
    }

    for sample in task_samples:
        next_trays = []
        for entry in as_list(sample.get("trays")):
            normalized = dict(entry)
            old_code = normalize_text(normalized.get("tray_code"))
            if old_code in code_map:
                serial, new_code = code_map[old_code]
                normalized["tray_id"] = encode_task_tray_id(serial)
                normalized["tray_code"] = new_code
            next_trays.append(normalized)
        sample["trays"] = next_trays

    task["tray_codes"] = expected_codes
    task["updated_at"] = now_business_text()
    return True


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

@router.get("/bootstrap")
def read_bootstrap() -> dict[str, Any]:
    snapshot = read_snapshot()
    samples_by_task = build_task_sample_map(snapshot["samples"])
    visible_tasks = [task for task in snapshot["tasks"] if is_visible_task(task, samples_by_task.get(task_code(task), []))]
    visible_tasks.sort(key=lambda item: task_code(item))

    overview = []
    snapshot_changed = False
    for index, task in enumerate(visible_tasks, start=1):
        task_samples, changed = ensure_task_samples_from_list(snapshot, task, samples_by_task.get(task_code(task), []))
        snapshot_changed = snapshot_changed or changed
        samples_by_task[task_code(task)] = task_samples
        overview.append(build_transfer_overview_row(task, task_samples, snapshot["experiments"], index))

    if snapshot_changed:
        write_snapshot(snapshot)

    return {
        "taskOverview": overview,
        "pendingTaskCount": sum(1 for item in overview if item["taskStatus"] == TASK_STATUS_PENDING),
        "storedTaskCount": sum(1 for item in overview if item["taskStatus"] == TASK_STATUS_STORED),
    }


@router.get("/tasks/{task_id}/workspace")
def read_task_workspace(task_id: str) -> dict[str, Any]:
    snapshot = read_snapshot()
    task = find_task(snapshot, task_id)
    if normalize_text(task.get("transfer_status")) == TASK_STATUS_RETURNED:
        raise HTTPException(status_code=404, detail="任务已归档")
    task_samples, changed = ensure_task_samples(snapshot, task)
    if repair_pending_tray_codes(task, task_samples):
        changed = True
    if changed:
        write_snapshot(snapshot)
    return serialize_workspace(
        task,
        task_samples,
        snapshot["samples"],
        snapshot["experiments"],
        snapshot["experiment_trays"],
        snapshot["experiment_samples"],
        snapshot["schedules"],
    )


@router.get("/trays/{tray_code}/dispatch")
def read_tray_dispatch(tray_code: str) -> dict[str, Any]:
    tray_code = normalize_tray_scan_code(tray_code)
    snapshot = read_snapshot()
    task, _tray_samples = find_tray_samples(snapshot, tray_code)
    task_samples = build_task_sample_map(snapshot["samples"]).get(task_code(task), [])
    if is_returned_task(task, task_samples):
        raise HTTPException(status_code=404, detail="任务已归档")
    if tray_is_currently_stocked_in_staging(snapshot, tray_code):
        raise HTTPException(status_code=400, detail=STAGING_STOCKED_TRANSFER_BLOCK_DETAIL)
    ensure_tray_currently_in_handover(task_samples, tray_code)
    return serialize_tray_dispatch_payload(snapshot, task, tray_code)

@router.post("/trays/{tray_code}/dispatch")
def dispatch_tray(
    tray_code: str,
    request: TrayDispatchRequest = Body(...),
    update_source: str = Header(default="", alias="X-MES-Update-Source"),
    update_request_id: str = Header(default="", alias="X-MES-Update-Request-Id"),
) -> dict[str, Any]:
    tray_code = normalize_tray_scan_code(tray_code)
    snapshot = read_snapshot()
    task, tray_samples = find_tray_samples(snapshot, tray_code)
    task_samples = build_task_sample_map(snapshot["samples"]).get(task_code(task), [])
    ensure_task_not_returned(task, task_samples)
    if transfer_status_for_task(task, task_samples) != TASK_STATUS_STORED:
        raise HTTPException(status_code=400, detail="该托盘尚未确认入库，不能出库")
    if tray_is_currently_stocked_in_staging(snapshot, tray_code):
        raise HTTPException(status_code=400, detail=STAGING_STOCKED_TRANSFER_BLOCK_DETAIL)
    ensure_tray_currently_in_handover(task_samples, tray_code)

    partial_axis_batch_completed = tray_has_scoped_partial_axis_batch_completion(
        task_code=task_code(task),
        tray_code=tray_code,
        experiments=snapshot["experiments"],
        experiment_runs=snapshot["experiment_runs"],
        experiment_run_steps=snapshot["experiment_run_steps"],
        experiment_run_trays=snapshot["experiment_run_trays"],
        experiment_trays=snapshot["experiment_trays"],
        schedules=snapshot["schedules"],
    )
    result = apply_dispatch(
        snapshot,
        task,
        tray_samples,
        tray_code,
        request,
        partial_axis_batch_completed=partial_axis_batch_completed,
        serialize_dispatch=serialize_tray_dispatch_payload,
        update_source=update_source,
        update_request_id=update_request_id,
        write_snapshot=write_snapshot,
    )
    return {
        "ok": True,
        **result,
        **serialize_tray_dispatch_payload(snapshot, task, tray_code),
    }


@router.get("/trays/{tray_code}/withdraw-dispatch")
def read_tray_withdraw_dispatch(tray_code: str) -> dict[str, Any]:
    tray_code = normalize_tray_scan_code(tray_code)
    snapshot = read_snapshot()
    task, _tray_samples = find_tray_samples(snapshot, tray_code)
    task_samples = build_task_sample_map(snapshot["samples"]).get(task_code(task), [])
    ensure_task_not_returned(task, task_samples)
    ensure_tray_can_lookup_withdrawal(task_samples, tray_code)
    return serialize_tray_dispatch_payload(snapshot, task, tray_code)

@router.post("/trays/{tray_code}/withdraw-dispatch")
def withdraw_dispatch_tray(tray_code: str, request: TrayWithdrawDispatchRequest = Body(...)) -> dict[str, Any]:
    tray_code = normalize_tray_scan_code(tray_code)
    snapshot = read_snapshot()
    task, _tray_samples = find_tray_samples(snapshot, tray_code)
    task_samples = build_task_sample_map(snapshot["samples"]).get(task_code(task), [])
    ensure_task_not_returned(task, task_samples)
    result = apply_tray_withdrawal_command(snapshot, task, task_samples, tray_code, request.reason)
    write_snapshot(snapshot)
    return {
        "ok": True,
        **result,
        **serialize_tray_dispatch_payload(snapshot, task, tray_code),
    }

@router.post("/tasks/{task_id}/allocate")
def save_task_allocation(
    task_id: str,
    request: TaskAllocationRequest = Body(...),
    update_source: str = Header(default="", alias="X-MES-Update-Source"),
    update_request_id: str = Header(default="", alias="X-MES-Update-Request-Id"),
) -> dict[str, Any]:
    snapshot = read_snapshot()
    task = find_task(snapshot, task_id)
    task_samples, _changed = ensure_task_samples(snapshot, task)
    ensure_task_not_returned(task, task_samples)
    current_reload_block_reason = reload_block_reason(task_samples, task)
    if current_reload_block_reason:
        raise HTTPException(status_code=400, detail=current_reload_block_reason)
    if transfer_status_for_task(task, task_samples) != TASK_STATUS_PENDING:
        raise HTTPException(status_code=400, detail="该任务已到货，不能重新保存预接驳托盘。")

    apply_task_allocation(
        snapshot,
        task,
        task_samples,
        request,
        max_assignable_count=max_assignable_tray_count(snapshot["samples"], task_samples),
    )
    write_snapshot(
        snapshot,
        replace_task_codes={task_code(task)},
        update_source=update_source,
        update_request_id=update_request_id,
    )
    return {
        "ok": True,
        "message": "托盘分配已保存",
        "scheduleReset": False,
        "workspace": serialize_workspace(
            task,
            task_samples,
            snapshot["samples"],
            snapshot["experiments"],
            snapshot["experiment_trays"],
            snapshot["experiment_samples"],
            snapshot["schedules"],
        ),
    }


@router.post("/tasks/{task_id}/print-barcodes")
def print_task_barcodes(task_id: str, request: TrayPrintBarcodeRequest = Body(...)) -> dict[str, Any]:
    snapshot = read_snapshot()
    task = find_task(snapshot, task_id)
    task_samples, _changed = ensure_task_samples(snapshot, task)
    ensure_task_not_returned(task, task_samples)
    if not has_saved_allocation(task_samples):
        raise HTTPException(status_code=400, detail="请先保存托盘，再打印二维码")

    assigned_trays = [tray for tray in build_assigned_trays(task, task_samples, TASK_STATUS_PENDING) if tray["samples"]]
    if not assigned_trays:
        raise HTTPException(status_code=400, detail="当前任务没有可打印二维码的托盘")

    printed = []
    for tray in assigned_trays:
        barcode = {
            **build_barcode_payload(
                tray["trayNo"],
                len(tray["samples"]),
                barcode_id=max(9000, tray["trayId"] + 7000),
            ),
            "objectId": tray["trayId"],
            "barcodeType": TRAY_QR_TYPE,
        }
        printed.append(barcode)
        sample_ids = {sample["sampleId"] for sample in tray["samples"]}
        for sample in task_samples:
            if sample_key(sample) not in sample_ids:
                continue
            next_trays = []
            for entry in as_list(sample.get("trays")):
                normalized = dict(entry)
                if int(normalized.get("tray_id") or 0) == tray["trayId"]:
                    normalized.update(
                        {
                            "status": TRAY_STATUS_PENDING,
                            "barcode_id": barcode["barcodeId"],
                            "barcode_no": barcode["barcodeNo"],
                            "barcode_content": barcode["barcodeContent"],
                            "barcode_type": TRAY_QR_TYPE,
                            "printed_at": now_text(),
                        }
                    )
                next_trays.append(normalized)
            sample["trays"] = next_trays

    write_snapshot(snapshot)
    workspace = serialize_workspace(
        task,
        task_samples,
        snapshot["samples"],
        snapshot["experiments"],
        snapshot["experiment_trays"],
        snapshot["experiment_samples"],
        snapshot["schedules"],
    )
    tray_label_map = {tray["trayNo"]: tray.get("experimentLabels", []) for tray in workspace["assignedTrays"]}
    for barcode in printed:
        barcode["experimentLabels"] = tray_label_map.get(barcode["barcodeNo"], [])
    return {"ok": True, "message": "二维码已生成", "barcodes": printed, "workspace": workspace}

@router.post("/tasks/{task_id}/confirm-storage")
def confirm_task_storage(
    task_id: str,
    update_source: str = Header(default="", alias="X-MES-Update-Source"),
    update_request_id: str = Header(default="", alias="X-MES-Update-Request-Id"),
) -> dict[str, Any]:
    snapshot = read_snapshot()
    task = find_task(snapshot, task_id)
    task_samples, _changed = ensure_task_samples(snapshot, task)
    ensure_task_not_returned(task, task_samples)
    assigned_trays = [tray for tray in build_assigned_trays(task, task_samples, TASK_STATUS_PENDING) if tray["samples"]]
    if not assigned_trays:
        raise HTTPException(status_code=400, detail="当前任务没有待入库托盘")
    if not has_saved_allocation(task_samples):
        raise HTTPException(status_code=400, detail="请先保存托盘，再确认入库")
    validate_saved_experiment_tray_allocation(task, task_samples, snapshot["experiments"], snapshot["experiment_trays"])

    apply_confirm_storage(snapshot, task, task_samples)
    write_snapshot(snapshot, update_source=update_source, update_request_id=update_request_id)
    return {
        "ok": True,
        "message": "任务已确认入库",
        "workspace": serialize_workspace(
            task,
            task_samples,
            snapshot["samples"],
            snapshot["experiments"],
            snapshot["experiment_trays"],
            snapshot["experiment_samples"],
            snapshot["schedules"],
        ),
    }

@router.post("/tasks/{task_id}/reload")
def reload_task_storage(task_id: str) -> dict[str, Any]:
    snapshot = read_snapshot()
    task = find_task(snapshot, task_id)
    task_samples, _changed = ensure_task_samples(snapshot, task)
    current_reload_block_reason = reload_block_reason(task_samples, task)
    if current_reload_block_reason:
        raise HTTPException(status_code=400, detail=current_reload_block_reason)

    schedule_reset = apply_reload(snapshot, task, task_samples)
    message = "任务已重新入库，已回到未入库列表"
    if schedule_reset:
        message = "任务已重新入库，已清空原有排程信息，需要重新排程。"
    write_snapshot(snapshot, replace_task_codes={task_code(task)})
    return {
        "ok": True,
        "message": message,
        "scheduleReset": schedule_reset,
        "workspace": serialize_workspace(
            task,
            task_samples,
            snapshot["samples"],
            snapshot["experiments"],
            snapshot["experiment_trays"],
            snapshot["experiment_samples"],
            snapshot["schedules"],
        ),
    }
