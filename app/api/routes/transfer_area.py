from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.core.storage_backend import get_storage_backend

router = APIRouter(prefix="/api/transfer-area", tags=["transfer-area"])

TASK_STATUS_PENDING = "未入库"
TASK_STATUS_STORED = "已入库"
TRAY_STATUS_ASSIGNED = "已预分配"
TRAY_STATUS_PENDING = "待入库"
TRAY_STATUS_STORED = "已入库"
DEFAULT_TRAY_LIMIT = 4
SYSTEM_TRAY_TOTAL = 20
EXCLUDED_TASK_STATUS_KEYWORDS = ("实验中", "实验已经完成", "实验已完成", "厂家收回")
TASK_TRAY_ID_BASE = 1000
STOCK_TRAY_ID_BASE = 2000
TRAY_CODE_PATTERN = re.compile(r"-TP-(\d+)$")
STOCK_TRAY_CODE_PATTERN = re.compile(r"^STOCK-TP-(\d+)$")
TRANSFER_HISTORY_ACTIONS = {"样品分装托盘", "任务已确认入库", "任务重新载装", "任务重新入库"}


class TrayAllocationPayload(BaseModel):
    tray_id: int = Field(alias="trayId")
    sample_ids: list[str] = Field(default_factory=list, alias="sampleIds")

    model_config = ConfigDict(populate_by_name=True)


class TaskAllocationRequest(BaseModel):
    tray_limit: int = Field(default=DEFAULT_TRAY_LIMIT, alias="trayLimit", ge=1, le=12)
    trays: list[TrayAllocationPayload] = Field(default_factory=list)

    model_config = ConfigDict(populate_by_name=True)


class TrayPrintBarcodeRequest(BaseModel):
    barcode_type: str = Field(default="CODE128", alias="barcodeType")

    model_config = ConfigDict(populate_by_name=True)


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def as_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def read_snapshot() -> dict[str, list[dict[str, Any]]]:
    storage = get_storage_backend()
    payload = storage.read_all()
    return {
        "tasks": [dict(item) for item in as_list(payload.get("mes.tasks")) if isinstance(item, dict)],
        "samples": [dict(item) for item in as_list(payload.get("mes.samples")) if isinstance(item, dict)],
        "schedules": [dict(item) for item in as_list(payload.get("mes.schedules")) if isinstance(item, dict)],
    }


def write_snapshot(snapshot: dict[str, list[dict[str, Any]]]) -> None:
    storage = get_storage_backend()
    storage.write_many(
        {
            "mes.tasks": snapshot["tasks"],
            "mes.samples": snapshot["samples"],
            "mes.schedules": snapshot["schedules"],
        }
    )


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


def build_task_sample_map(samples: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    for sample in samples:
        result.setdefault(sample_task_code(sample), []).append(sample)
    for entries in result.values():
        entries.sort(key=sample_sort_key)
    return result


def is_visible_task(task: dict[str, Any], task_samples: list[dict[str, Any]]) -> bool:
    status_text = " ".join(
        [
            normalize_text(task.get("status")),
            normalize_text(task.get("displayStatus")),
            normalize_text(task.get("display_status")),
        ]
    )
    if any(keyword in status_text for keyword in EXCLUDED_TASK_STATUS_KEYWORDS):
        return False
    return bool(task_samples) or bool(normalize_text(task.get("sample_count")))


def transfer_status_for_task(task: dict[str, Any], task_samples: list[dict[str, Any]]) -> str:
    explicit = normalize_text(task.get("transfer_status"))
    if explicit == TASK_STATUS_STORED:
        return TASK_STATUS_STORED
    if explicit == TASK_STATUS_PENDING:
        return TASK_STATUS_PENDING

    if task_samples and all(normalize_text(sample.get("status")) == TASK_STATUS_STORED for sample in task_samples):
        return TASK_STATUS_STORED
    return TASK_STATUS_PENDING


def task_tray_limit(task: dict[str, Any]) -> int:
    raw = task.get("tray_limit")
    try:
        parsed = int(str(raw).strip())
    except (TypeError, ValueError):
        parsed = 0
    return parsed if parsed > 0 else DEFAULT_TRAY_LIMIT


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
        "barcodeContent": f"TRAY|TRAY:{tray_code_value}|LOAD:{sample_count}",
    }


def append_history(sample: dict[str, Any], action: str, detail: str) -> None:
    history = as_list(sample.get("history"))
    history.insert(
        0,
        {
            "id": f"sample-event-{normalize_text(sample.get('id')) or normalize_text(sample.get('code'))}-{len(history) + 1}",
            "time": datetime.now().isoformat(timespec="seconds"),
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


def serialize_sample(sample: dict[str, Any], task_status: str) -> dict[str, Any]:
    return {
        "sampleId": sample_key(sample),
        "sampleNo": sample_code(sample),
        "sampleStatus": TASK_STATUS_STORED if task_status == TASK_STATUS_STORED else TASK_STATUS_PENDING,
    }


def build_assigned_trays(task: dict[str, Any], task_samples: list[dict[str, Any]], task_status: str) -> list[dict[str, Any]]:
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
        grouped[tray_code_value]["samples"].append(serialize_sample(sample, task_status))

    if grouped:
        trays = [grouped[tray_code] for tray_code in sorted(ordered_codes, key=tray_serial_from_code)]
        for tray in trays:
            tray["loadQty"] = len(tray["samples"])
            if tray["barcode"]:
                tray["barcode"]["barcodeContent"] = f"TRAY|TASK:{task_code(task)}|TRAY:{tray['trayNo']}|LOAD:{tray['loadQty']}"
                tray["barcodeData"] = tray["barcode"]["barcodeContent"]
        return trays

    limit = task_tray_limit(task)
    tray_count = max(1, math.ceil(len(task_samples) / limit)) if task_samples else 1
    trays = []
    for index in range(tray_count):
        start = index * limit
        end = start + limit
        tray_samples = [serialize_sample(sample, task_status) for sample in task_samples[start:end]]
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


def count_system_occupied_trays(all_samples: list[dict[str, Any]]) -> int:
    tray_codes = {
        normalize_text(entry.get("tray_code"))
        for sample in all_samples
        for entry in as_list(sample.get("trays"))
        if normalize_text(entry.get("tray_code"))
    }
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
    }
    return len(tray_codes)


def max_assignable_tray_count(
    all_samples: list[dict[str, Any]],
    task_samples: list[dict[str, Any]],
) -> int:
    return max(0, SYSTEM_TRAY_TOTAL - count_occupied_trays_excluding_task(all_samples, task_samples))


def build_inventory_trays(assigned_trays: list[dict[str, Any]], capacity: int, all_samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    remaining_count = max(0, SYSTEM_TRAY_TOTAL - count_system_occupied_trays(all_samples))
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
    task["updated_at"] = datetime.now().isoformat(timespec="seconds")
    return True


def task_progress(task: dict[str, Any], task_status: str, assigned_trays: list[dict[str, Any]]) -> str:
    if task_status == TASK_STATUS_STORED:
        return "已确认入库"
    if not task_arrival_time(task):
        return "中控已预分配托盘，等待样品送达"
    non_empty = [tray for tray in assigned_trays if tray["samples"]]
    if non_empty and all(tray["barcode"] for tray in non_empty):
        return "条形码已打印，待确认入库"
    return "样品已送达，待打印条形码"


def serialize_workspace(task: dict[str, Any], task_samples: list[dict[str, Any]], all_samples: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    current_task_status = transfer_status_for_task(task, task_samples)
    assigned_trays = build_assigned_trays(task, task_samples, current_task_status)
    current_progress = task_progress(task, current_task_status, assigned_trays)
    printed_tray_count = sum(1 for tray in assigned_trays if tray["barcode"])
    global_samples = all_samples if all_samples is not None else task_samples
    max_assignable_count = max_assignable_tray_count(global_samples, task_samples)
    required_tray_count = sum(1 for tray in assigned_trays if tray["samples"])
    tray_capacity_exceeded = required_tray_count > max_assignable_count
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
            "experimentTypeText": normalize_text(task.get("test_type")),
            "taskStatus": current_task_status,
            "taskProgress": current_progress,
            "receivedTime": task_arrival_time(task),
            "sampleCount": len(task_samples) or int(task.get("sample_count") or 0),
            "trayCount": len(assigned_trays),
            "printedTrayCount": printed_tray_count,
            "trayLimit": task_tray_limit(task),
            "totalTrayCount": SYSTEM_TRAY_TOTAL,
            "remainingTrayCount": max(0, SYSTEM_TRAY_TOTAL - count_system_occupied_trays(global_samples)),
            "maxAssignableTrayCount": max_assignable_count,
            "requiredTrayCount": required_tray_count,
            "trayCapacityExceeded": tray_capacity_exceeded,
            "trayCapacityMessage": tray_capacity_message,
        },
        "assignedTrays": assigned_trays,
        "trayInventory": build_inventory_trays(assigned_trays, task_tray_limit(task), global_samples),
        "allocationSaved": has_saved_allocation(task_samples),
    }


def find_task(snapshot: dict[str, list[dict[str, Any]]], task_id: str) -> dict[str, Any]:
    normalized = normalize_text(task_id)
    for task in snapshot["tasks"]:
        if task_key(task) == normalized or task_code(task) == normalized:
            return task
    raise HTTPException(status_code=404, detail="未找到任务")


def update_task_samples_for_pending(task: dict[str, Any], task_samples: list[dict[str, Any]]) -> None:
    location = "接驳区" if task_arrival_time(task) else ""
    status = TASK_STATUS_PENDING if task_arrival_time(task) else "运输中"
    flow_status = "到货" if task_arrival_time(task) else "运输中"
    for sample in task_samples:
        sample["location"] = location
        sample["status"] = status
        sample["flow_status"] = flow_status


@router.get("/bootstrap")
def read_bootstrap() -> dict[str, Any]:
    snapshot = read_snapshot()
    samples_by_task = build_task_sample_map(snapshot["samples"])
    visible_tasks = [task for task in snapshot["tasks"] if is_visible_task(task, samples_by_task.get(task_code(task), []))]
    visible_tasks.sort(key=lambda item: task_code(item))

    overview = []
    for index, task in enumerate(visible_tasks, start=1):
        task_samples = samples_by_task.get(task_code(task), [])
        workspace = serialize_workspace(task, task_samples, snapshot["samples"])
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

    return {
        "taskOverview": overview,
        "pendingTaskCount": sum(1 for item in overview if item["taskStatus"] == TASK_STATUS_PENDING),
        "storedTaskCount": sum(1 for item in overview if item["taskStatus"] == TASK_STATUS_STORED),
    }


@router.get("/tasks/{task_id}/workspace")
def read_task_workspace(task_id: str) -> dict[str, Any]:
    snapshot = read_snapshot()
    task = find_task(snapshot, task_id)
    task_samples = build_task_sample_map(snapshot["samples"]).get(task_code(task), [])
    if repair_pending_tray_codes(task, task_samples):
        write_snapshot(snapshot)
    return serialize_workspace(task, task_samples, snapshot["samples"])


@router.post("/tasks/{task_id}/allocate")
def save_task_allocation(task_id: str, request: TaskAllocationRequest = Body(...)) -> dict[str, Any]:
    snapshot = read_snapshot()
    task = find_task(snapshot, task_id)
    task_samples = build_task_sample_map(snapshot["samples"]).get(task_code(task), [])
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

    for sample in task_samples:
        clear_transfer_history(sample)
        sample["trays"] = []
    update_task_samples_for_pending(task, task_samples)

    tray_codes = []
    for tray in request.trays:
        if len(tray.sample_ids) > request.tray_limit:
            raise HTTPException(status_code=400, detail="单托盘样品数量超过统一上限")
        _serial, tray_no = decode_tray_id(task_code(task), tray.tray_id)
        if tray.sample_ids:
            tray_codes.append(tray_no)
        for sample_id in tray.sample_ids:
            if sample_id not in sample_map:
                raise HTTPException(status_code=400, detail="存在不属于当前任务的样品")
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

    task["tray_limit"] = request.tray_limit
    task["tray_codes"] = sorted(set(tray_codes))
    task["transfer_status"] = TASK_STATUS_PENDING
    task["updated_at"] = datetime.now().isoformat(timespec="seconds")
    write_snapshot(snapshot)
    return {"ok": True, "message": "托盘分配已保存", "workspace": serialize_workspace(task, task_samples, snapshot["samples"])}


@router.post("/tasks/{task_id}/print-barcodes")
def print_task_barcodes(task_id: str, request: TrayPrintBarcodeRequest = Body(...)) -> dict[str, Any]:
    snapshot = read_snapshot()
    task = find_task(snapshot, task_id)
    task_samples = build_task_sample_map(snapshot["samples"]).get(task_code(task), [])
    if not task_arrival_time(task):
        raise HTTPException(status_code=400, detail="样品尚未送达接驳区，不能打印条形码")

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
    return {"ok": True, "message": "条形码已生成", "barcodes": printed, "workspace": serialize_workspace(task, task_samples, snapshot["samples"])}


@router.post("/tasks/{task_id}/confirm-storage")
def confirm_task_storage(task_id: str) -> dict[str, Any]:
    snapshot = read_snapshot()
    task = find_task(snapshot, task_id)
    task_samples = build_task_sample_map(snapshot["samples"]).get(task_code(task), [])
    assigned_trays = [tray for tray in build_assigned_trays(task, task_samples, TASK_STATUS_PENDING) if tray["samples"]]

    if not assigned_trays:
        raise HTTPException(status_code=400, detail="当前任务没有待入库托盘")
    if not has_saved_allocation(task_samples):
        raise HTTPException(status_code=400, detail="请先保存托盘，再确认入库")

    task["transfer_status"] = TASK_STATUS_STORED
    task["updated_at"] = datetime.now().isoformat(timespec="seconds")
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

    write_snapshot(snapshot)
    return {"ok": True, "message": "任务已确认入库", "workspace": serialize_workspace(task, task_samples, snapshot["samples"])}


@router.post("/tasks/{task_id}/reload")
def reload_task_storage(task_id: str) -> dict[str, Any]:
    snapshot = read_snapshot()
    task = find_task(snapshot, task_id)
    task_samples = build_task_sample_map(snapshot["samples"]).get(task_code(task), [])

    task["transfer_status"] = TASK_STATUS_PENDING
    task["updated_at"] = datetime.now().isoformat(timespec="seconds")
    update_task_samples_for_pending(task, task_samples)

    for sample in task_samples:
        next_trays = []
        for entry in as_list(sample.get("trays")):
            normalized = dict(entry)
            normalized.update(
                {
                    "status": TASK_STATUS_PENDING,
                    "barcode_id": None,
                    "barcode_no": None,
                    "barcode_content": None,
                    "barcode_type": None,
                    "printed_at": None,
                }
            )
            next_trays.append(normalized)
        sample["trays"] = next_trays
        append_history(sample, "任务重新入库", task_code(task))

    write_snapshot(snapshot)
    return {"ok": True, "message": "任务已重新入库，已回到未入库列表", "workspace": serialize_workspace(task, task_samples, snapshot["samples"])}
