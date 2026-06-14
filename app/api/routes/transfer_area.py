from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.api.routes.storage import publish_storage_update
from app.core.storage_backend import get_storage_backend, normalize_experiment_status_text, normalize_storage_payload
from app.core.time_utils import now_business_datetime, now_business_text, parse_business_datetime
from app.services.appearance_inspection import (
    APPEARANCE_EVENT_ROOM,
    APPEARANCE_STOCK_OUT_ACTION,
    PRE_EXPERIMENT_APPEARANCE_STATUS,
)
from app.services.laboratory_completion import tray_assigned_experiments_are_completed
from app.services.laboratory_operations import acquire_laboratory_storage_commit_lock, clear_fixture_ready_marker
from app.services.storage_atomic import merge_concurrent_storage_updates

router = APIRouter(prefix="/api/transfer-area", tags=["transfer-area"])

TASK_STATUS_PENDING = "未入库"
TASK_STATUS_STORED = "到货"
TASK_STATUS_RETURNED = "厂家收回"
RETURNED_REENTRY_BLOCK_REASON = "该任务已厂家收回，不能重新入库。"
TRAY_STATUS_ASSIGNED = "已预分配"
TRAY_STATUS_PENDING = "待入库"
TRAY_STATUS_STORED = "到货"
DEFAULT_TRAY_LIMIT = 4
MAX_TRAY_LIMIT = 99
SYSTEM_TRAY_TOTAL = 10
STAGING_LOCATION = "恒温恒湿间（暂存间）"
APPEARANCE_LOCATION = "外观检测间"
APPEARANCE_STORED_STATUS = "外观检测间存放"
POST_EXPERIMENT_STAGING_SENT_STATUS = "送至实验后暂存间"
POST_EXPERIMENT_STAGING_STOCKED_STATUS = "实验后暂存间存放"
WITHDRAW_BLOCKED_TRAY_STATUSES = {
    "已到达实验室",
    "工装夹具安装",
    "实验准备就绪",
    "实验进行中",
    "实验中",
    "实验已完成",
    "实验完成",
    "实验已经完成",
    POST_EXPERIMENT_STAGING_STOCKED_STATUS,
    "送至外观检测间",
    "外观检测间存放",
    "厂家收回",
}
TRANSFER_STORAGE_UPDATE_KEYS = (
    "mes.tasks",
    "mes.samples",
    "mes.schedules",
    "mes.experiments",
    "mes.experiment_runs",
    "mes.experiment_run_trays",
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
TASK_TRAY_ID_BASE = 1000
STOCK_TRAY_ID_BASE = 2000
TRAY_CODE_PATTERN = re.compile(r"-TP-(\d+)$")
STOCK_TRAY_CODE_PATTERN = re.compile(r"^STOCK-TP-(\d+)$")
TRANSFER_HISTORY_ACTIONS = {"样品分装托盘", "任务已确认入库", "任务重新载装", "任务重新入库"}
TRAY_OUTBOUND_STATUSES = {
    "送至暂存间",
    POST_EXPERIMENT_STAGING_SENT_STATUS,
    "已到达暂存间",
    "送至实验室",
    "已到达实验室",
    "工装夹具安装",
    "实验准备就绪",
    "实验进行中",
    "实验已完成",
    POST_EXPERIMENT_STAGING_STOCKED_STATUS,
    "送至外观检测间",
    "外观检测间存放",
    PRE_EXPERIMENT_APPEARANCE_STATUS,
    "厂家收回",
}
TRAY_LAB_REDISPATCH_STATUSES = {
    "已到达暂存间",
    POST_EXPERIMENT_STAGING_STOCKED_STATUS,
    "送至外观检测间",
    "外观检测间存放",
    PRE_EXPERIMENT_APPEARANCE_STATUS,
    "实验完成",
    "实验已经完成",
    "实验已完成",
}
STARTED_EXPERIMENT_TRAY_STATUSES = (
    "实验进行中",
    "实验中",
    "实验已完成",
    "实验完成",
    "实验已经完成",
    POST_EXPERIMENT_STAGING_STOCKED_STATUS,
    "送至外观检测间",
    "外观检测间存放",
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


class TrayAllocationPayload(BaseModel):
    tray_id: int = Field(alias="trayId")
    sample_ids: list[str] = Field(default_factory=list, alias="sampleIds")

    model_config = ConfigDict(populate_by_name=True)


class ExperimentTrayAllocationPayload(BaseModel):
    experiment_code: str = Field(alias="experimentCode")
    tray_ids: list[int] = Field(default_factory=list, alias="trayIds")

    model_config = ConfigDict(populate_by_name=True)


class TaskAllocationRequest(BaseModel):
    tray_limit: int = Field(default=DEFAULT_TRAY_LIMIT, alias="trayLimit", ge=1, le=MAX_TRAY_LIMIT)
    trays: list[TrayAllocationPayload] = Field(default_factory=list)
    experiment_trays: list[ExperimentTrayAllocationPayload] = Field(default_factory=list, alias="experimentTrays")

    model_config = ConfigDict(populate_by_name=True)


class TrayPrintBarcodeRequest(BaseModel):
    barcode_type: str = Field(default="CODE128", alias="barcodeType")

    model_config = ConfigDict(populate_by_name=True)


class TrayDispatchRequest(BaseModel):
    target_type: str = Field(alias="targetType")
    target_name: str = Field(alias="targetName")
    experiment_code: str = Field(default="", alias="experimentCode")

    model_config = ConfigDict(populate_by_name=True)


class TrayWithdrawDispatchRequest(BaseModel):
    reason: str = ""

    model_config = ConfigDict(populate_by_name=True)


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def is_handover_stored_status(value: Any) -> bool:
    return normalize_text(value) == TASK_STATUS_STORED


def as_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def now_text() -> str:
    return now_business_text(include_seconds=False)


def parse_datetime_value(value: Any) -> datetime | None:
    return parse_business_datetime(value)


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
    if any(keyword in status for keyword in ["维护", "维修", "保养"]) and not (end_at and end_at < now):
        return True
    return bool(start_at and start_at <= now and (not end_at or now <= end_at))


def find_unavailable_device(snapshot: dict[str, list[dict[str, Any]]], device_name: str) -> dict[str, Any] | None:
    normalized_device = normalize_text(device_name)
    for device in snapshot.get("devices", []):
        if normalized_device not in {normalize_text(device.get("code")), normalize_text(device.get("name"))}:
            continue
        if device_is_unavailable(device):
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
        "experiment_trays": [dict(item) for item in as_list(payload.get("mes.experiment_trays")) if isinstance(item, dict)],
        "experiment_samples": [dict(item) for item in as_list(payload.get("mes.experiment_samples")) if isinstance(item, dict)],
        "staging_events": [dict(item) for item in as_list(payload.get("mes.staging_events")) if isinstance(item, dict)],
        "devices": [dict(item) for item in as_list(payload.get("mes.devices")) if isinstance(item, dict)],
    }


def write_snapshot(snapshot: dict[str, list[dict[str, Any]]]) -> None:
    storage = get_storage_backend()
    updates = {
        "mes.tasks": snapshot["tasks"],
        "mes.samples": snapshot["samples"],
        "mes.schedules": snapshot["schedules"],
        "mes.experiments": snapshot["experiments"],
        "mes.experiment_runs": snapshot["experiment_runs"],
        "mes.experiment_run_trays": snapshot["experiment_run_trays"],
        "mes.experiment_trays": snapshot["experiment_trays"],
        "mes.experiment_samples": snapshot["experiment_samples"],
        "mes.staging_events": snapshot["staging_events"],
    }
    with acquire_laboratory_storage_commit_lock():
        storage.write_many(merge_concurrent_storage_updates(storage.read_all(), updates))
    publish_storage_update(list(TRANSFER_STORAGE_UPDATE_KEYS))


def task_code(task: dict[str, Any]) -> str:
    return normalize_text(task.get("code"))


def task_key(task: dict[str, Any]) -> str:
    return normalize_text(task.get("id")) or task_code(task)


def sample_key(sample: dict[str, Any]) -> str:
    return normalize_text(sample.get("id")) or normalize_text(sample.get("code"))


def sample_code(sample: dict[str, Any]) -> str:
    return normalize_text(sample.get("code"))


def sample_task_code(sample: dict[str, Any]) -> str:
    return normalize_text(sample.get("task_code"))


def sample_sort_key(sample: dict[str, Any]) -> tuple[str, str]:
    return (sample_code(sample), sample_key(sample))


def sample_serial_sort_key(sample: dict[str, Any]) -> tuple[int, str, str]:
    matched = re.search(r"-SP-(\d+)$", sample_code(sample))
    serial = int(matched.group(1)) if matched else 1000
    return (serial, sample_code(sample), sample_key(sample))


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
    refreshed_samples = build_task_sample_map(snapshot["samples"]).get(task_code(task), [])
    return refreshed_samples, True


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


def ensure_task_samples(snapshot: dict[str, list[dict[str, Any]]], task: dict[str, Any]) -> tuple[list[dict[str, Any]], bool]:
    samples_by_task = build_task_sample_map(snapshot["samples"])
    task_code_value = task_code(task)
    task_samples = samples_by_task.get(task_code_value, [])
    task_samples, trimmed = limit_task_samples_to_planned_count(snapshot, task, task_samples)
    generated_samples = build_generated_task_samples(task, task_samples)
    if not generated_samples:
        return task_samples, trimmed
    snapshot["samples"].extend(generated_samples)
    refreshed_samples = build_task_sample_map(snapshot["samples"]).get(task_code_value, [])
    return refreshed_samples, True


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


def decode_tray_id(task_code_value: str, tray_id: int) -> tuple[int, str]:
    if tray_id >= STOCK_TRAY_ID_BASE:
        serial = tray_id - STOCK_TRAY_ID_BASE
        return serial, f"STOCK-TP-{serial:03d}"
    serial = tray_id - TASK_TRAY_ID_BASE
    return serial, f"{task_code_value}-TP-{serial:03d}"


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


def build_barcode_payload(tray_code_value: str, sample_count: int, barcode_id: int | None = None) -> dict[str, Any]:
    return {
        "barcodeId": barcode_id or max(9000, 9000 + tray_serial_from_code(tray_code_value)),
        "barcodeNo": tray_code_value,
        "barcodeContent": tray_code_value,
    }


def append_history(sample: dict[str, Any], action: str, detail: str) -> None:
    history = as_list(sample.get("history"))
    history.insert(
        0,
        {
            "id": f"sample-event-{normalize_text(sample.get('id')) or normalize_text(sample.get('code'))}-{len(history) + 1}",
            "time": now_business_text(),
            "action": action,
            "location": normalize_text(sample.get("location")),
            "owner": normalize_text(sample.get("owner")),
            "status": normalize_text(sample.get("status")),
            "detail": detail,
        },
    )
    sample["history"] = history


def clear_transfer_history(sample: dict[str, Any]) -> None:
    sample["history"] = [
        entry
        for entry in as_list(sample.get("history"))
        if normalize_text(entry.get("action")) not in TRANSFER_HISTORY_ACTIONS
    ]


def build_sample_experiment_map(
    task: dict[str, Any],
    task_samples: list[dict[str, Any]],
    experiment_trays: list[dict[str, Any]],
    experiment_samples: list[dict[str, Any]],
) -> dict[str, list[str]]:
    task_code_value = task_code(task)
    sample_experiment_codes: dict[str, set[str]] = {}

    for entry in experiment_samples:
        if normalize_text(entry.get("task_code")) != task_code_value:
            continue
        sample_code_value = normalize_text(entry.get("sample_code"))
        experiment_code_value = normalize_text(entry.get("experiment_code"))
        if not sample_code_value or not experiment_code_value:
            continue
        sample_experiment_codes.setdefault(sample_code_value, set()).add(experiment_code_value)

    tray_experiment_codes: dict[str, set[str]] = {}
    for entry in experiment_trays:
        if normalize_text(entry.get("task_code")) != task_code_value:
            continue
        tray_code_value = normalize_text(entry.get("tray_code"))
        experiment_code_value = normalize_text(entry.get("experiment_code"))
        if not tray_code_value or not experiment_code_value:
            continue
        tray_experiment_codes.setdefault(tray_code_value, set()).add(experiment_code_value)

    for sample in task_samples:
        sample_code_value = sample_code(sample)
        if not sample_code_value:
            continue
        for tray in as_list(sample.get("trays")):
            tray_code_value = normalize_text(tray.get("tray_code"))
            if not tray_code_value:
                continue
            for experiment_code_value in tray_experiment_codes.get(tray_code_value, set()):
                sample_experiment_codes.setdefault(sample_code_value, set()).add(experiment_code_value)

    return {
        sample_code_value: sorted(experiment_codes, key=lambda value: value)
        for sample_code_value, experiment_codes in sample_experiment_codes.items()
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
                tray["barcode"]["barcodeContent"] = tray["trayNo"]
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


def experiment_type_label(experiment: dict[str, Any]) -> str:
    return normalize_text(experiment.get("required_device")) or normalize_text(experiment.get("experiment_name"))


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


def build_experiment_summary(task: dict[str, Any], experiments: list[dict[str, Any]]) -> str:
    task_code_value = task_code(task)
    labels: list[str] = []
    for experiment in experiments:
        if normalize_text(experiment.get("task_code")) != task_code_value:
            continue
        label = experiment_type_label(experiment)
        if label and label not in labels:
            labels.append(label)
    return " / ".join(labels)


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
        return "条形码已打印，待确认入库"
    return "样品已送达，待打印条形码"


def serialize_workspace(
    task: dict[str, Any],
    task_samples: list[dict[str, Any]],
    all_samples: list[dict[str, Any]] | None = None,
    experiments: list[dict[str, Any]] | None = None,
    experiment_trays: list[dict[str, Any]] | None = None,
    experiment_samples: list[dict[str, Any]] | None = None,
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
        },
        "assignedTrays": assigned_trays,
        "experiments": task_experiments,
        "trayInventory": build_inventory_trays(assigned_trays, task_tray_limit(task), global_samples),
        "allocationSaved": has_saved_allocation(task_samples),
    }


def find_task(snapshot: dict[str, list[dict[str, Any]]], task_id: str) -> dict[str, Any]:
    normalized = normalize_text(task_id)
    for task in snapshot["tasks"]:
        if task_key(task) == normalized or task_code(task) == normalized:
            return task
    raise HTTPException(status_code=404, detail="未找到任务")


def find_tray_samples(snapshot: dict[str, list[dict[str, Any]]], tray_code_value: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    normalized_tray_code = normalize_text(tray_code_value)
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
) -> list[dict[str, Any]]:
    task_experiments = [
        row for row in build_task_experiment_rows(task, experiments, experiment_trays)
        if tray["trayNo"] in row["assignedTrayNos"]
    ]
    scheduled_candidates = []
    unscheduled_candidates = []

    for experiment in task_experiments:
        matching_schedules = [
            entry for entry in schedules
            if normalize_text(entry.get("task_code")) == task_code(task)
            and normalize_text(entry.get("experiment_code")) == experiment["experimentCode"]
            and normalize_text(entry.get("device"))
        ]
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
    )
    tray = next(
        (item for item in workspace["assignedTrays"] if normalize_text(item.get("trayNo")) == normalize_text(tray_code)),
        None,
    )
    if tray is None:
        raise HTTPException(status_code=404, detail="未找到托盘")

    actual_tray_status = normalize_text(tray.get("trayStatus"))
    for sample in task_samples:
        for entry in as_list(sample.get("trays")):
            if normalize_text(entry.get("tray_code")) == normalize_text(tray_code):
                actual_tray_status = normalize_text(entry.get("status")) or actual_tray_status
                break
        if actual_tray_status and actual_tray_status != normalize_text(tray.get("trayStatus")):
            break

    return {
        "tray": {
            "trayNo": tray["trayNo"],
            "trayStatus": actual_tray_status,
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
        ),
    }


def staging_event_room(event: dict[str, Any]) -> str:
    return "appearance" if normalize_text(event.get("room") or event.get("storage_room") or event.get("storageRoom")) == "appearance" else "staging"


def staging_event_matches_room(event: dict[str, Any], room: str) -> bool:
    target_room = "appearance" if normalize_text(room) == "appearance" else "staging"
    return staging_event_room(event) == target_room


def latest_staging_event_for_tray(
    snapshot: dict[str, list[dict[str, Any]]],
    tray_code: str,
    *,
    action: str = "",
    room: str = "",
) -> dict[str, Any] | None:
    normalized_action = normalize_text(action)
    matched_events = [
        dict(event)
        for event in as_list(snapshot.get("staging_events"))
        if normalize_text(event.get("tray_code")) == normalize_text(tray_code)
        and (not normalized_action or normalize_text(event.get("action")) == normalized_action)
        and (not normalize_text(room) or staging_event_matches_room(event, room))
    ]
    if not matched_events:
        return None
    matched_events.sort(key=lambda event: (parse_datetime_value(event.get("time")) or datetime.min, normalize_text(event.get("id"))))
    return matched_events[-1]


def sample_has_staging_dispatch_history(task_samples: list[dict[str, Any]], tray_code: str) -> bool:
    normalized_tray_code = normalize_text(tray_code)
    dispatch_entries: list[dict[str, Any]] = []
    for sample in task_samples:
        if not any(normalize_text(entry.get("tray_code")) == normalized_tray_code for entry in as_list(sample.get("trays"))):
            continue
        for history_entry in as_list(sample.get("history")):
            if normalize_text(history_entry.get("action")) in {"暂存间扫码出库", "接驳区扫码出库", "送至实验室"}:
                dispatch_entries.append(dict(history_entry))
    if not dispatch_entries:
        return False
    dispatch_entries.sort(key=lambda entry: parse_datetime_value(entry.get("time")) or datetime.min)
    return normalize_text(dispatch_entries[-1].get("action")) == "暂存间扫码出库"


def latest_appearance_storage_status_for_tray(
    task_samples: list[dict[str, Any]],
    tray_code: str,
    dispatch_time: datetime,
) -> str:
    normalized_tray_code = normalize_text(tray_code)
    candidates: list[dict[str, Any]] = []
    for sample in task_samples:
        if not any(normalize_text(entry.get("tray_code")) == normalized_tray_code for entry in as_list(sample.get("trays"))):
            continue
        for history_entry in as_list(sample.get("history")):
            action = normalize_text(history_entry.get("action"))
            status = normalize_text(history_entry.get("status"))
            location = normalize_text(history_entry.get("location"))
            if action != "外观检测间扫码入库":
                continue
            if status not in {APPEARANCE_STORED_STATUS, PRE_EXPERIMENT_APPEARANCE_STATUS, "已到达外观检测间"} and location != APPEARANCE_LOCATION:
                continue
            entry_time = parse_datetime_value(history_entry.get("time")) or datetime.min
            if entry_time > dispatch_time:
                continue
            candidates.append(
                {
                    "status": status if status in {APPEARANCE_STORED_STATUS, PRE_EXPERIMENT_APPEARANCE_STATUS} else APPEARANCE_STORED_STATUS,
                    "time": entry_time,
                }
            )
    if not candidates:
        return APPEARANCE_STORED_STATUS
    candidates.sort(key=lambda entry: entry["time"])
    return candidates[-1]["status"]


def restore_status_for_withdrawal(
    snapshot: dict[str, list[dict[str, Any]]],
    task_samples: list[dict[str, Any]],
    tray_code: str,
) -> tuple[str, str, str]:
    latest_stock_out_event = latest_staging_event_for_tray(snapshot, tray_code, action="stock_out")
    if latest_stock_out_event:
        if staging_event_matches_room(latest_stock_out_event, "appearance"):
            dispatch_time = parse_datetime_value(latest_stock_out_event.get("time")) or datetime.max
            return latest_appearance_storage_status_for_tray(task_samples, tray_code, dispatch_time), APPEARANCE_LOCATION, "appearance"
        return "已到达暂存间", STAGING_LOCATION, "staging"
    if sample_has_staging_dispatch_history(task_samples, tray_code):
        return "已到达暂存间", STAGING_LOCATION, "staging"
    return "到货", "接驳区", "handover"


def tray_has_laboratory_progress(task_samples: list[dict[str, Any]], tray_code: str) -> bool:
    normalized_tray_code = normalize_text(tray_code)
    for sample in task_samples:
        for entry in as_list(sample.get("trays")):
            if normalize_text(entry.get("tray_code")) != normalized_tray_code:
                continue
            if normalize_text(entry.get("status")) in WITHDRAW_BLOCKED_TRAY_STATUSES:
                return True
    return False


def tray_current_status(task_samples: list[dict[str, Any]], tray_code: str) -> str:
    normalized_tray_code = normalize_text(tray_code)
    for sample in task_samples:
        for entry in as_list(sample.get("trays")):
            if normalize_text(entry.get("tray_code")) == normalized_tray_code:
                return normalize_text(entry.get("status")) or normalize_text(sample.get("status"))
    return ""


def apply_tray_withdrawal(
    snapshot: dict[str, list[dict[str, Any]]],
    task: dict[str, Any],
    tray_code: str,
    reason: str = "",
) -> dict[str, Any]:
    task_samples = build_task_sample_map(snapshot["samples"]).get(task_code(task), [])
    current_status = tray_current_status(task_samples, tray_code)
    if tray_has_laboratory_progress(task_samples, tray_code):
        raise HTTPException(status_code=400, detail="该托盘已进入试验间流程，不能撤回出库")
    if current_status not in {"送至实验室", "送至暂存间"}:
        raise HTTPException(status_code=400, detail="该托盘当前不在可撤回的出库状态")

    target_status, target_location, restore_scope = restore_status_for_withdrawal(snapshot, task_samples, tray_code)
    timestamp = now_business_text()
    normalized_tray_code = normalize_text(tray_code)
    affected_count = 0
    for sample in task_samples:
        tray_matches = False
        next_trays = []
        for entry in as_list(sample.get("trays")):
            normalized = dict(entry)
            if normalize_text(normalized.get("tray_code")) == normalized_tray_code:
                tray_matches = True
                normalized["status"] = target_status
                normalized["updated_at"] = timestamp
                clear_fixture_ready_marker(normalized)
            next_trays.append(normalized)
        if not tray_matches:
            continue
        affected_count += 1
        remaining_blocked_tray = any(
            normalize_text(entry.get("tray_code")) != normalized_tray_code
            and normalize_text(entry.get("status")) in WITHDRAW_BLOCKED_TRAY_STATUSES
            for entry in next_trays
        )
        if not remaining_blocked_tray:
            sample["location"] = target_location
            sample["status"] = target_status
            sample["flow_status"] = target_status
        sample["updated_at"] = timestamp
        sample["trays"] = next_trays
        detail = f"{normalized_tray_code} 撤回出库至{target_status}"
        if normalize_text(reason):
            detail = f"{detail}（{normalize_text(reason)}）"
        append_history(sample, "撤回出库", detail)

    if affected_count == 0:
        raise HTTPException(status_code=404, detail="未找到托盘")

    if restore_scope in {"staging", "appearance"}:
        latest_event = latest_staging_event_for_tray(snapshot, tray_code, action="stock_out", room=restore_scope) or {}
        staging_event = {
            "id": f"staging-event-{normalized_tray_code}-{len(snapshot['staging_events']) + 1}",
            "tray_code": normalized_tray_code,
            "task_code": task_code(task),
            "action": "stock_out_withdraw",
            "time": timestamp,
            "operator": normalize_text(reason) or "撤回出库",
            "target_lab": normalize_text(latest_event.get("target_lab")),
            "target_experiment_code": normalize_text(latest_event.get("target_experiment_code")),
        }
        if restore_scope == "appearance":
            staging_event["room"] = "appearance"
        snapshot["staging_events"].append(staging_event)

    write_snapshot(snapshot)
    payload = serialize_tray_dispatch_payload(snapshot, task, tray_code)
    return {
        "ok": True,
        "message": f"{normalized_tray_code}已撤回出库",
        "affectedSampleCount": affected_count,
        "restoredStatus": target_status,
        "restoredLocation": target_location,
        **payload,
    }


def update_task_samples_for_pending(task: dict[str, Any], task_samples: list[dict[str, Any]]) -> None:
    for sample in task_samples:
        sample["location"] = ""
        sample["status"] = "运输中"
        sample["flow_status"] = "运输中"


@router.get("/bootstrap")
def read_bootstrap() -> dict[str, Any]:
    snapshot = read_snapshot()
    samples_by_task = build_task_sample_map(snapshot["samples"])
    visible_tasks = [task for task in snapshot["tasks"] if is_visible_task(task, samples_by_task.get(task_code(task), []))]
    visible_tasks.sort(key=lambda item: task_code(item))

    overview = []
    snapshot_changed = False
    for index, task in enumerate(visible_tasks, start=1):
        task_samples, changed = ensure_task_samples(snapshot, task)
        snapshot_changed = snapshot_changed or changed
        workspace = serialize_workspace(
            task,
            task_samples,
            snapshot["samples"],
            snapshot["experiments"],
            snapshot["experiment_trays"],
            snapshot["experiment_samples"],
        )
        task_payload = workspace["task"]
        overview.append(
            {
                "seq": index,
                "taskId": task_payload["taskId"],
                "taskNo": task_payload["taskNo"],
                "taskName": task_payload["taskName"],
                "taskType": task_payload["taskType"],
                "experimentTypeText": task_payload["experimentTypeText"],
                "sampleCount": task_payload["sampleCount"],
                "taskStatus": task_payload["taskStatus"],
                "taskProgress": task_payload["taskProgress"],
                "receivedTime": task_payload["receivedTime"],
                "sampleCodes": [sample_code(sample) for sample in task_samples],
                "sampleCodesText": " / ".join(sample_code(sample) for sample in task_samples),
            }
        )

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
    )


@router.get("/trays/{tray_code}/dispatch")
def read_tray_dispatch(tray_code: str) -> dict[str, Any]:
    snapshot = read_snapshot()
    task, _tray_samples = find_tray_samples(snapshot, tray_code)
    task_samples = build_task_sample_map(snapshot["samples"]).get(task_code(task), [])
    if is_returned_task(task, task_samples):
        raise HTTPException(status_code=404, detail="任务已归档")
    return serialize_tray_dispatch_payload(snapshot, task, tray_code)


@router.post("/trays/{tray_code}/dispatch")
def dispatch_tray(tray_code: str, request: TrayDispatchRequest = Body(...)) -> dict[str, Any]:
    snapshot = read_snapshot()
    task, tray_samples = find_tray_samples(snapshot, tray_code)
    task_samples = build_task_sample_map(snapshot["samples"]).get(task_code(task), [])
    ensure_task_not_returned(task, task_samples)
    if transfer_status_for_task(task, task_samples) != TASK_STATUS_STORED:
        raise HTTPException(status_code=400, detail="该托盘尚未确认入库，不能出库")

    current_tray_status = ""
    for sample in tray_samples:
        for entry in as_list(sample.get("trays")):
            if normalize_text(entry.get("tray_code")) == normalize_text(tray_code):
                current_tray_status = normalize_text(entry.get("status"))
                break
        if current_tray_status:
            break

    target_type = normalize_text(request.target_type)
    target_name = normalize_text(request.target_name)
    if target_type == "staging":
        post_experiment_staging_dispatch = tray_assigned_experiments_are_completed(
            task_code=task_code(task),
            tray_code=tray_code,
            experiment_trays=snapshot["experiment_trays"],
            experiment_run_trays=snapshot["experiment_run_trays"],
        )
        appearance_to_staging_dispatch = current_tray_status == APPEARANCE_STORED_STATUS
        if current_tray_status in TRAY_OUTBOUND_STATUSES and not (post_experiment_staging_dispatch or appearance_to_staging_dispatch):
            raise HTTPException(status_code=400, detail="该托盘已送往目标位置，请勿重复操作")
        next_status = POST_EXPERIMENT_STAGING_SENT_STATUS if post_experiment_staging_dispatch else "送至暂存间"
        next_location = STAGING_LOCATION
        detail = normalize_text(tray_code)
    elif target_type == "lab":
        dispatch_payload = serialize_tray_dispatch_payload(snapshot, task, tray_code)
        matched_destination = next(
            (
                item for item in dispatch_payload["destinations"]
                if item["targetType"] == "lab"
                and normalize_text(item.get("targetName")) == target_name
                and normalize_text(item.get("experimentCode")) == normalize_text(request.experiment_code)
                and bool(item.get("scheduled"))
            ),
            None,
        )
        if matched_destination is None:
            raise HTTPException(status_code=400, detail="目标实验室与当前托盘不匹配")
        unavailable_device = find_unavailable_device(snapshot, target_name)
        if unavailable_device:
            device_name = normalize_text(unavailable_device.get("code")) or target_name
            raise HTTPException(status_code=400, detail=f"{device_name}设备维护中，禁止送至该实验室")
        if (
            current_tray_status in TRAY_OUTBOUND_STATUSES
            and current_tray_status not in TRAY_LAB_REDISPATCH_STATUSES
        ):
            raise HTTPException(status_code=400, detail="该托盘已送往目标位置，请勿重复操作")
        next_status = "送至实验室"
        next_location = target_name
        detail = f"{normalize_text(tray_code)} -> {target_name}"
    else:
        raise HTTPException(status_code=400, detail="请选择有效的目标位置")

    timestamp = now_business_text()
    dispatched_from_pre_appearance = target_type == "lab" and current_tray_status == PRE_EXPERIMENT_APPEARANCE_STATUS
    for sample in tray_samples:
        sample["location"] = next_location
        sample["status"] = next_status
        sample["flow_status"] = next_status
        sample["updated_at"] = timestamp
        next_trays = []
        for entry in as_list(sample.get("trays")):
            normalized = dict(entry)
            if normalize_text(normalized.get("tray_code")) == normalize_text(tray_code):
                normalized["status"] = next_status
                normalized["updated_at"] = timestamp
                clear_fixture_ready_marker(normalized)
                if target_type == "lab":
                    normalized["target_lab"] = target_name
                    normalized["target_experiment_code"] = normalize_text(request.experiment_code)
                else:
                    normalized.pop("target_lab", None)
                    normalized.pop("target_experiment_code", None)
            next_trays.append(normalized)
        sample["trays"] = next_trays
        append_history(sample, next_status, detail)

    if dispatched_from_pre_appearance:
        normalized_tray_code = normalize_text(tray_code)
        snapshot["staging_events"].append(
            {
                "id": f"staging-event-{normalized_tray_code}-{len(snapshot['staging_events']) + 1}",
                "tray_code": normalized_tray_code,
                "task_code": task_code(task),
                "room": APPEARANCE_EVENT_ROOM,
                "action": APPEARANCE_STOCK_OUT_ACTION,
                "target_lab": target_name,
                "target_experiment_code": normalize_text(request.experiment_code),
                "target_type": "lab",
                "time": timestamp,
            }
        )

    write_snapshot(snapshot)
    return {
        "ok": True,
        "message": f"{normalize_text(tray_code)}已标记为{next_status}",
        "affectedSampleCount": len(tray_samples),
        **serialize_tray_dispatch_payload(snapshot, task, tray_code),
    }


@router.post("/trays/{tray_code}/withdraw-dispatch")
def withdraw_dispatch_tray(tray_code: str, request: TrayWithdrawDispatchRequest = Body(...)) -> dict[str, Any]:
    snapshot = read_snapshot()
    task, _tray_samples = find_tray_samples(snapshot, tray_code)
    task_samples = build_task_sample_map(snapshot["samples"]).get(task_code(task), [])
    ensure_task_not_returned(task, task_samples)
    return apply_tray_withdrawal(snapshot, task, tray_code, request.reason)


@router.post("/tasks/{task_id}/allocate")
def save_task_allocation(task_id: str, request: TaskAllocationRequest = Body(...)) -> dict[str, Any]:
    snapshot = read_snapshot()
    task = find_task(snapshot, task_id)
    task_samples, _changed = ensure_task_samples(snapshot, task)
    ensure_task_not_returned(task, task_samples)
    current_reload_block_reason = reload_block_reason(task_samples, task)
    if current_reload_block_reason:
        raise HTTPException(status_code=400, detail=current_reload_block_reason)
    if transfer_status_for_task(task, task_samples) != TASK_STATUS_PENDING:
        raise HTTPException(status_code=400, detail="该任务已到货，不能重新保存预接驳托盘。")
    sample_map = {sample_key(sample): sample for sample in task_samples}
    requested_ids = [sample_id for tray in request.trays for sample_id in tray.sample_ids]
    requested_tray_count = sum(1 for tray in request.trays if tray.sample_ids)
    max_assignable_count = max_assignable_tray_count(snapshot["samples"], task_samples)

    if sorted(requested_ids) != sorted(sample_map.keys()):
        raise HTTPException(status_code=400, detail="所有任务样品必须且只能分配到一个托盘中")
    if len(set(requested_ids)) != len(requested_ids):
        raise HTTPException(status_code=400, detail="样品不能重复分配到多个托盘")
    if requested_tray_count > max_assignable_count:
        raise HTTPException(
            status_code=400,
            detail=f"系统剩余托盘不足，当前最多可分配 {max_assignable_count} 个托盘。",
        )
    loaded_tray_ids = {tray.tray_id for tray in request.trays if tray.sample_ids}
    task_experiment_codes = {
        normalize_text(experiment.get("experiment_code"))
        for experiment in snapshot["experiments"]
        if normalize_text(experiment.get("task_code")) == task_code(task)
        and normalize_text(experiment.get("experiment_code"))
    }
    if task_experiment_codes:
        seen_experiment_codes: set[str] = set()
        selected_loaded_tray_ids: set[int] = set()
        for selection in request.experiment_trays:
            experiment_code = normalize_text(selection.experiment_code)
            if not experiment_code:
                continue
            if experiment_code not in task_experiment_codes or experiment_code in seen_experiment_codes:
                raise HTTPException(status_code=400, detail="实验托盘分配信息不完整")
            seen_experiment_codes.add(experiment_code)
            selected_tray_ids = set(selection.tray_ids)
            if not selected_tray_ids:
                raise HTTPException(status_code=400, detail="每个实验都必须至少分配一个托盘")
            if not selected_tray_ids.issubset(loaded_tray_ids):
                raise HTTPException(status_code=400, detail="实验托盘分配引用了无效托盘")
            selected_loaded_tray_ids.update(selected_tray_ids)
        if seen_experiment_codes != task_experiment_codes:
            raise HTTPException(status_code=400, detail="每个实验都必须至少分配一个托盘")
        if loaded_tray_ids and selected_loaded_tray_ids != loaded_tray_ids:
            raise HTTPException(status_code=400, detail="有样品的托盘必须至少分配一个实验")

    for sample in task_samples:
        clear_transfer_history(sample)
        sample["trays"] = []
    update_task_samples_for_pending(task, task_samples)
    next_experiment_trays = [
        entry for entry in snapshot["experiment_trays"] if normalize_text(entry.get("task_code")) != task_code(task)
    ]
    next_experiment_samples = [
        entry for entry in snapshot["experiment_samples"] if normalize_text(entry.get("task_code")) != task_code(task)
    ]
    snapshot["experiment_runs"] = [
        entry for entry in snapshot["experiment_runs"] if normalize_text(entry.get("task_code")) != task_code(task)
    ]
    snapshot["experiment_run_trays"] = [
        entry for entry in snapshot["experiment_run_trays"] if normalize_text(entry.get("task_code")) != task_code(task)
    ]

    tray_codes = []
    tray_code_by_id: dict[int, str] = {}
    tray_sample_codes_by_no: dict[str, list[str]] = {}
    for tray in request.trays:
        if len(tray.sample_ids) > request.tray_limit:
            raise HTTPException(status_code=400, detail="单托盘样品数量超过统一上限")
        _serial, tray_no = decode_tray_id(task_code(task), tray.tray_id)
        tray_code_by_id[tray.tray_id] = tray_no
        tray_sample_codes_by_no[tray_no] = []
        if tray.sample_ids:
            tray_codes.append(tray_no)
        for sample_id in tray.sample_ids:
            if sample_id not in sample_map:
                raise HTTPException(status_code=400, detail="存在不属于当前任务的样品")
            tray_sample_codes_by_no[tray_no].append(sample_code(sample_map[sample_id]))
            sample_map[sample_id]["trays"].append(
                {
                    "tray_id": tray.tray_id,
                    "tray_code": tray_no,
                    "tray_type": "标准托盘",
                    "quantity": 1,
                    "status": TASK_STATUS_PENDING,
                    "barcode_id": None,
                    "barcode_no": None,
                    "barcode_content": None,
                    "barcode_type": None,
                    "printed_at": None,
                }
            )
            append_history(sample_map[sample_id], "样品分装托盘", tray_no)

    for selection in request.experiment_trays:
        experiment_code = normalize_text(selection.experiment_code)
        if not experiment_code:
            continue
        experiment_sample_codes: set[str] = set()
        for tray_id in selection.tray_ids:
            tray_no = tray_code_by_id.get(tray_id)
            if not tray_no:
                continue
            next_experiment_trays.append(
                {
                    "task_code": task_code(task),
                    "experiment_code": experiment_code,
                    "tray_code": tray_no,
                }
            )
            experiment_sample_codes.update(
                sample_code_value
                for sample_code_value in tray_sample_codes_by_no.get(tray_no, [])
                if sample_code_value
            )
        for sample_code_value in sorted(experiment_sample_codes):
            next_experiment_samples.append(
                {
                    "task_code": task_code(task),
                    "experiment_code": experiment_code,
                    "sample_code": sample_code_value,
                }
            )

    task["tray_limit"] = request.tray_limit
    task["tray_codes"] = sorted(set(tray_codes))
    task["transfer_status"] = TASK_STATUS_PENDING
    task["updated_at"] = now_business_text()
    snapshot["experiment_trays"] = next_experiment_trays
    snapshot["experiment_samples"] = next_experiment_samples
    write_snapshot(snapshot)
    return {
        "ok": True,
        "message": "托盘分配已保存",
        "workspace": serialize_workspace(
            task,
            task_samples,
            snapshot["samples"],
            snapshot["experiments"],
            snapshot["experiment_trays"],
            snapshot["experiment_samples"],
        ),
    }


@router.post("/tasks/{task_id}/print-barcodes")
def print_task_barcodes(task_id: str, request: TrayPrintBarcodeRequest = Body(...)) -> dict[str, Any]:
    snapshot = read_snapshot()
    task = find_task(snapshot, task_id)
    task_samples, _changed = ensure_task_samples(snapshot, task)
    ensure_task_not_returned(task, task_samples)
    if not has_saved_allocation(task_samples):
        raise HTTPException(status_code=400, detail="请先保存托盘，再打印条形码")

    assigned_trays = [tray for tray in build_assigned_trays(task, task_samples, TASK_STATUS_PENDING) if tray["samples"]]
    if not assigned_trays:
        raise HTTPException(status_code=400, detail="当前任务没有可打印条形码的托盘")

    printed = []
    for tray in assigned_trays:
        barcode = {
            **build_barcode_payload(
                tray["trayNo"],
                len(tray["samples"]),
                barcode_id=max(9000, tray["trayId"] + 7000),
            ),
            "objectId": tray["trayId"],
            "barcodeType": request.barcode_type,
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
                            "barcode_type": request.barcode_type,
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
    )
    tray_label_map = {tray["trayNo"]: tray.get("experimentLabels", []) for tray in workspace["assignedTrays"]}
    for barcode in printed:
        barcode["experimentLabels"] = tray_label_map.get(barcode["barcodeNo"], [])
    return {"ok": True, "message": "条形码已生成", "barcodes": printed, "workspace": workspace}


@router.post("/tasks/{task_id}/confirm-storage")
def confirm_task_storage(task_id: str) -> dict[str, Any]:
    snapshot = read_snapshot()
    task = find_task(snapshot, task_id)
    task_samples, _changed = ensure_task_samples(snapshot, task)
    ensure_task_not_returned(task, task_samples)
    assigned_trays = [tray for tray in build_assigned_trays(task, task_samples, TASK_STATUS_PENDING) if tray["samples"]]

    if not assigned_trays:
        raise HTTPException(status_code=400, detail="当前任务没有待入库托盘")
    if not has_saved_allocation(task_samples):
        raise HTTPException(status_code=400, detail="请先保存托盘，再确认入库")

    task["transfer_status"] = TASK_STATUS_STORED
    now_iso = now_business_text()
    if not task_arrival_time(task):
        task["arrival_at"] = now_iso
    task["updated_at"] = now_iso
    for sample in task_samples:
        sample["location"] = "接驳区"
        sample["status"] = TASK_STATUS_STORED
        sample["flow_status"] = TASK_STATUS_STORED
        next_trays = []
        for entry in as_list(sample.get("trays")):
            normalized = dict(entry)
            normalized["status"] = TRAY_STATUS_STORED
            next_trays.append(normalized)
        sample["trays"] = next_trays
        append_history(sample, "任务已确认入库", task_code(task))

    task_code_value = task_code(task)
    for experiment in snapshot["experiments"]:
        if normalize_text(experiment.get("task_code")) != task_code_value:
            continue
        experiment_code_value = normalize_text(experiment.get("experiment_code"))
        if not experiment_code_value:
            continue
        if has_formal_schedule(snapshot, task_code_value, experiment_code_value):
            experiment["unscheduled_since"] = ""
            continue
        experiment["unscheduled_since"] = now_iso

    write_snapshot(snapshot)
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
    snapshot["experiment_trays"] = [
        entry for entry in snapshot["experiment_trays"] if normalize_text(entry.get("task_code")) != task_code(task)
    ]
    snapshot["experiment_samples"] = [
        entry for entry in snapshot["experiment_samples"] if normalize_text(entry.get("task_code")) != task_code(task)
    ]
    snapshot["experiment_runs"] = [
        entry for entry in snapshot["experiment_runs"] if normalize_text(entry.get("task_code")) != task_code(task)
    ]
    snapshot["experiment_run_trays"] = [
        entry for entry in snapshot["experiment_run_trays"] if normalize_text(entry.get("task_code")) != task_code(task)
    ]

    task["transfer_status"] = TASK_STATUS_PENDING
    task["tray_codes"] = []
    task["updated_at"] = now_business_text()
    update_task_samples_for_pending(task, task_samples)

    for sample in task_samples:
        sample["trays"] = []
        append_history(sample, "任务重新入库", task_code(task))

    write_snapshot(snapshot)
    return {
        "ok": True,
        "message": "任务已重新入库，已回到未入库列表",
        "workspace": serialize_workspace(
            task,
            task_samples,
            snapshot["samples"],
            snapshot["experiments"],
            snapshot["experiment_trays"],
            snapshot["experiment_samples"],
        ),
    }
