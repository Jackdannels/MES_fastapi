from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Header, HTTPException
from app.api.routes.storage import publish_storage_update, tray_has_scoped_partial_axis_batch_completion
from app.core.storage_backend import get_storage_backend
from app.core.time_utils import now_business_text
from app.services.laboratory_operations import (
    acquire_laboratory_storage_commit_lock,
    with_laboratory_storage_commit_lock,
)
from app.services.storage_atomic import merge_concurrent_storage_updates
from app.api.routes.transfer_area_commands import (
    TASK_STATUS_PENDING,
    TASK_STATUS_STORED,
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
    TRAY_QR_TYPE,
    TaskAllocationRequest,
    TrayDispatchRequest,
    TrayPrintBarcodeRequest,
    TrayWithdrawDispatchRequest,
)
from app.api.routes.transfer_area_views import (
    as_list,
    normalize_text,
    sample_code,
    sample_key,
    sample_serial_sort_key,
    sample_sort_key,
    task_code,
)

from app.api.routes.transfer_area_read_views import (
    TASK_STATUS_RETURNED,
    TRAY_STATUS_PENDING,
    are_task_experiments_all_completed,
    build_assigned_trays,
    build_barcode_payload,
    build_inventory_trays,
    build_overview_tray_progress_rows,
    build_task_experiment_rows,
    build_task_sample_map,
    build_transfer_overview_row,
    build_tray_dispatch_destinations,
    build_tray_experiment_labels,
    build_tray_qr_content,
    count_occupied_trays_excluding_task,
    count_system_occupied_trays,
    encode_stock_tray_id,
    encode_task_tray_id,
    encode_tray_id,
    ensure_task_not_returned,
    find_task,
    find_tray_samples,
    has_saved_allocation,
    is_handover_stored_status,
    is_returned_task,
    is_visible_task,
    max_assignable_tray_count,
    outbound_status_for_task,
    parse_datetime_value,
    parse_positive_int,
    reload_block_reason,
    returned_task_block_reason,
    sample_has_transfer_work,
    schedule_is_completed,
    serialize_sample,
    serialize_tray_dispatch_payload,
    serialize_workspace,
    started_experiment_status_for_task,
    task_arrival_time,
    task_has_schedule,
    task_progress,
    task_tray_limit,
    transfer_status_for_task,
    tray_serial_from_code,
)
from app.api.routes.transfer_area_snapshot import (
    TRANSFER_ALLOCATION_READ_FIELDS,
    TRANSFER_BOOTSTRAP_READ_FIELDS,
    TRANSFER_WORKSPACE_READ_FIELDS,
    hydrate_transfer_snapshot_for_write,
    read_transfer_snapshot,
)

router = APIRouter(prefix="/api/transfer-area", tags=["transfer-area"])

STAGING_STOCKED_TRANSFER_BLOCK_DETAIL = "该托盘已在暂存间入库，请从暂存间出库"
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
TRANSFER_ALLOCATION_UPDATE_KEYS = (
    "mes.tasks",
    "mes.samples",
    "mes.schedules",
    "mes.experiments",
    "mes.experiment_runs",
    "mes.experiment_run_trays",
    "mes.experiment_trays",
    "mes.experiment_samples",
)
CONFIRM_STORAGE_READ_FIELDS = (
    "tasks",
    "samples",
    "schedules",
    "experiments",
    "experiment_trays",
    "experiment_samples",
)


def now_text() -> str:
    return now_business_text(include_seconds=False)






def read_snapshot(
    fields: tuple[str, ...] | None = None,
    *,
    storage: Any | None = None,
) -> dict[str, list[dict[str, Any]]]:
    return read_transfer_snapshot(storage or get_storage_backend(), fields)


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


def write_confirm_storage_changes(
    snapshot: dict[str, list[dict[str, Any]]],
    task_samples: list[dict[str, Any]],
    *,
    update_source: str = "",
    update_request_id: str = "",
) -> None:
    storage = get_storage_backend()
    updates = {
        "mes.tasks": snapshot["tasks"],
        "mes.samples": task_samples,
        "mes.experiments": snapshot["experiments"],
    }
    scoped_writer = getattr(storage, "write_many_scoped", None)
    if callable(scoped_writer):
        scoped_writer(updates)
    else:
        storage.write_many({**updates, "mes.samples": snapshot["samples"]})

    source = normalize_text(update_source)
    request_id = normalize_text(update_request_id)
    if source or request_id:
        publish_storage_update(list(TRANSFER_STORAGE_UPDATE_KEYS), source=source, request_id=request_id)
    else:
        publish_storage_update(list(TRANSFER_STORAGE_UPDATE_KEYS))


def write_task_allocation_changes(
    snapshot: dict[str, list[dict[str, Any]]],
    task_code_value: str,
    *,
    update_source: str = "",
    update_request_id: str = "",
) -> None:
    normalized_task_code = normalize_text(task_code_value)
    if not normalized_task_code:
        raise ValueError("task_code is required for task-scoped allocation writes")

    storage = get_storage_backend()
    updates = {
        "mes.tasks": snapshot["tasks"],
        "mes.samples": snapshot["samples"],
        "mes.experiment_runs": snapshot["experiment_runs"],
        "mes.experiment_run_trays": snapshot["experiment_run_trays"],
        "mes.experiment_trays": snapshot["experiment_trays"],
        "mes.experiment_samples": snapshot["experiment_samples"],
    }
    scoped_writer = getattr(storage, "write_task_allocation_scope", None)
    if callable(scoped_writer):
        scoped_writer(normalized_task_code, updates)
    else:
        # Compatibility fallback for non-MySQL test/development backends. The
        # production MySQL backend always uses the task-scoped transaction.
        write_snapshot(
            hydrate_transfer_snapshot_for_write(storage, snapshot),
            replace_task_codes={normalized_task_code},
            update_source=update_source,
            update_request_id=update_request_id,
        )
        return

    source = normalize_text(update_source)
    request_id = normalize_text(update_request_id)
    if source or request_id:
        publish_storage_update(list(TRANSFER_ALLOCATION_UPDATE_KEYS), source=source, request_id=request_id)
    else:
        publish_storage_update(list(TRANSFER_ALLOCATION_UPDATE_KEYS))






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



















def build_bootstrap_response(snapshot: dict[str, list[dict[str, Any]]]) -> tuple[dict[str, Any], bool]:
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

    return (
        {
            "taskOverview": overview,
            "pendingTaskCount": sum(1 for item in overview if item["taskStatus"] == TASK_STATUS_PENDING),
            "storedTaskCount": sum(1 for item in overview if item["taskStatus"] == TASK_STATUS_STORED),
        },
        snapshot_changed,
    )


@router.get("/bootstrap")
def read_bootstrap() -> dict[str, Any]:
    response, _snapshot_changed = build_bootstrap_response(
        read_snapshot(TRANSFER_BOOTSTRAP_READ_FIELDS),
    )
    return response


def build_task_workspace_response(
    snapshot: dict[str, list[dict[str, Any]]],
    task_id: str,
) -> tuple[dict[str, Any], bool]:
    task = find_task(snapshot, task_id)
    if normalize_text(task.get("transfer_status")) == TASK_STATUS_RETURNED:
        raise HTTPException(status_code=404, detail="任务已归档")
    task_samples, changed = ensure_task_samples(snapshot, task)
    if repair_pending_tray_codes(task, task_samples):
        changed = True
    return (
        serialize_workspace(
            task,
            task_samples,
            snapshot["samples"],
            snapshot["experiments"],
            snapshot["experiment_trays"],
            snapshot["experiment_samples"],
            snapshot["schedules"],
        ),
        changed,
    )


@router.get("/tasks/{task_id}/workspace")
def read_task_workspace(task_id: str) -> dict[str, Any]:
    response, _snapshot_changed = build_task_workspace_response(
        read_snapshot(TRANSFER_WORKSPACE_READ_FIELDS),
        task_id,
    )
    return response


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
@with_laboratory_storage_commit_lock
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
@with_laboratory_storage_commit_lock
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
@with_laboratory_storage_commit_lock
def save_task_allocation(
    task_id: str,
    request: TaskAllocationRequest = Body(...),
    update_source: str = Header(default="", alias="X-MES-Update-Source"),
    update_request_id: str = Header(default="", alias="X-MES-Update-Request-Id"),
) -> dict[str, Any]:
    snapshot = read_snapshot(TRANSFER_ALLOCATION_READ_FIELDS)
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
    write_task_allocation_changes(
        snapshot,
        task_code(task),
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
@with_laboratory_storage_commit_lock
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
@with_laboratory_storage_commit_lock
def confirm_task_storage(
    task_id: str,
    update_source: str = Header(default="", alias="X-MES-Update-Source"),
    update_request_id: str = Header(default="", alias="X-MES-Update-Request-Id"),
) -> dict[str, Any]:
    snapshot = read_snapshot(CONFIRM_STORAGE_READ_FIELDS)
    task = find_task(snapshot, task_id)
    task_samples, _changed = ensure_task_samples(snapshot, task)
    ensure_task_not_returned(task, task_samples)
    if transfer_status_for_task(task, task_samples) == TASK_STATUS_STORED:
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
    assigned_trays = [tray for tray in build_assigned_trays(task, task_samples, TASK_STATUS_PENDING) if tray["samples"]]
    if not assigned_trays:
        raise HTTPException(status_code=400, detail="当前任务没有待入库托盘")
    if not has_saved_allocation(task_samples):
        raise HTTPException(status_code=400, detail="请先保存托盘，再确认入库")
    validate_saved_experiment_tray_allocation(task, task_samples, snapshot["experiments"], snapshot["experiment_trays"])

    apply_confirm_storage(snapshot, task, task_samples)
    write_confirm_storage_changes(
        snapshot,
        task_samples,
        update_source=update_source,
        update_request_id=update_request_id,
    )
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
@with_laboratory_storage_commit_lock
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
