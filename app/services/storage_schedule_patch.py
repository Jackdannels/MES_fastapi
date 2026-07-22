from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from typing import Any

from app.core.time_utils import now_business_datetime, parse_business_datetime
from app.services.storage_atomic import generic_item_key


PATCHABLE_KEYS = {
    "mes.conflicts",
    "mes.experiments",
    "mes.schedules",
    "mes.streams",
    "mes.tasks",
}
SCHEDULES_KEY = "mes.schedules"
DEVICES_KEY = "mes.devices"
STORAGE_AREA_CODES = {"AREA_STAGING_PRE", "AREA_STAGING_POST", "AREA_APPEARANCE"}
COMPLETED_STATUSES = {"实验已完成", "实验完成", "实验已经完成"}
MAINTENANCE_STATUSES = ("维修", "保养")
SCHEDULE_MAINTENANCE_CONFLICT_DETAIL = "该设备处于维修状态，不可排程"
MAINTENANCE_SCHEDULE_CONFLICT_DETAIL = "维保窗口内已有排程，请先调整或删除排程"
MAINTENANCE_START_TIME_DETAIL = "维保开始时间不得早于当前时间"
MAINTENANCE_END_TIME_DETAIL = "维保结束时间必须晚于开始时间"


class StorageSchedulePatchError(Exception):
    def __init__(self, detail: str, status_code: int = 400) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def row_key(key: str, row: Any) -> str:
    return generic_item_key(key, row)


def schedule_lab_code(schedule: Any) -> str:
    if not isinstance(schedule, dict):
        return ""
    return normalize_text(schedule.get("lab_code") or schedule.get("labCode") or schedule.get("lab"))


def schedule_lab_id(schedule: Any) -> str:
    if not isinstance(schedule, dict):
        return ""
    return normalize_text(schedule.get("lab_id") if "lab_id" in schedule else schedule.get("labId"))


def schedule_device(schedule: Any) -> str:
    if not isinstance(schedule, dict):
        return ""
    return normalize_text(schedule.get("device") or schedule.get("device_name") or schedule.get("deviceName") or schedule.get("lab_name") or schedule.get("labName"))


def device_id(device: Any) -> str:
    if not isinstance(device, dict):
        return ""
    return normalize_text(device.get("id") or device.get("lab_id") or device.get("labId"))


def device_code(device: Any) -> str:
    if not isinstance(device, dict):
        return ""
    return normalize_text(device.get("code") or device.get("lab_code") or device.get("labCode"))


def device_names(device: Any) -> set[str]:
    if not isinstance(device, dict):
        return set()
    return {
        value
        for value in [
            device_code(device),
            normalize_text(device.get("name")),
            normalize_text(device.get("location")),
        ]
        if value
    }


def schedule_targets_storage_area(schedule: Any) -> bool:
    code = schedule_lab_code(schedule)
    if code:
        return code in STORAGE_AREA_CODES
    device = schedule_device(schedule)
    return "暂存间" in device or "外观检测间" in device


def schedules_match_lab(left: Any, right: Any) -> bool:
    left_id = schedule_lab_id(left)
    right_id = schedule_lab_id(right)
    if left_id and right_id:
        return left_id == right_id
    left_code = schedule_lab_code(left)
    right_code = schedule_lab_code(right)
    if left_code and right_code:
        return left_code == right_code
    return bool(schedule_device(left) and schedule_device(left) == schedule_device(right))


def schedule_matches_device(schedule: Any, device: Any) -> bool:
    lab_id = schedule_lab_id(schedule)
    if lab_id and device_id(device):
        return lab_id == device_id(device)
    lab_code = schedule_lab_code(schedule)
    names = device_names(device)
    if lab_code and names:
        return lab_code in names
    scheduled_device = schedule_device(schedule)
    return bool(scheduled_device and scheduled_device in names)


def schedule_window(schedule: Any) -> tuple[Any, Any]:
    if not isinstance(schedule, dict):
        return None, None
    return parse_business_datetime(schedule.get("start_at") or schedule.get("startAt")), parse_business_datetime(
        schedule.get("end_at") or schedule.get("endAt")
    )


def device_maintenance_window(device: Any) -> tuple[Any, Any] | None:
    if not isinstance(device, dict):
        return None
    start_at = parse_business_datetime(device.get("maintenance_start_at") or device.get("maintenanceStartAt"))
    end_at = parse_business_datetime(device.get("maintenance_end_at") or device.get("maintenanceEndAt"))
    status = normalize_text(device.get("status"))
    has_maintenance_status = any(keyword in status for keyword in MAINTENANCE_STATUSES)
    if not start_at and not has_maintenance_status:
        return None
    if not start_at:
        start_at = datetime.min
    if end_at and end_at <= start_at:
        return None
    return start_at, end_at


def validate_maintenance_time_order(
    devices: list[dict[str, Any]],
    current_devices: list[dict[str, Any]] | None = None,
) -> None:
    current_by_key = {
        (device_id(device) or device_code(device)): device
        for device in current_devices or []
        if isinstance(device, dict) and (device_id(device) or device_code(device))
    }
    for device in devices:
        start_at = parse_business_datetime(device.get("maintenance_start_at") or device.get("maintenanceStartAt"))
        end_at = parse_business_datetime(device.get("maintenance_end_at") or device.get("maintenanceEndAt"))
        if end_at and not start_at:
            raise StorageSchedulePatchError("维保结束时间需要有效的开始时间", status_code=422)
        if start_at and end_at and end_at <= start_at:
            raise StorageSchedulePatchError(MAINTENANCE_END_TIME_DETAIL, status_code=422)
        maintenance_type = normalize_text(device.get("maintenance_type") or device.get("maintenanceType"))
        current = current_by_key.get(device_id(device) or device_code(device))
        current_start_at = parse_business_datetime(
            current.get("maintenance_start_at") or current.get("maintenanceStartAt")
        ) if current else None
        current_type = normalize_text(
            current.get("maintenance_type") or current.get("maintenanceType")
        ) if current else ""
        if (
            maintenance_type in {"计划维修", "计划保养"}
            and start_at
            and start_at < now_business_datetime()
            and (start_at != current_start_at or maintenance_type != current_type)
        ):
            raise StorageSchedulePatchError(MAINTENANCE_START_TIME_DETAIL, status_code=422)


def schedule_status(schedule: Any) -> str:
    if not isinstance(schedule, dict):
        return ""
    return normalize_text(schedule.get("status") or schedule.get("schedule_status") or schedule.get("scheduleStatus"))


def schedule_is_completed(schedule: Any) -> bool:
    return schedule_status(schedule) in COMPLETED_STATUSES


def schedules_overlap(left: Any, right: Any) -> bool:
    left_start, left_end = schedule_window(left)
    right_start, right_end = schedule_window(right)
    return bool(left_start and left_end and right_start and right_end and left_start < right_end and right_start < left_end)


def schedule_overlaps_maintenance(schedule: Any, device: Any) -> bool:
    schedule_start, schedule_end = schedule_window(schedule)
    maintenance_window = device_maintenance_window(device)
    if not schedule_start or not schedule_end or not maintenance_window:
        return False
    maintenance_start, maintenance_end = maintenance_window
    return maintenance_start < schedule_end and (maintenance_end is None or maintenance_end > schedule_start)


def schedule_task_code(schedule: Any) -> str:
    if not isinstance(schedule, dict):
        return ""
    return normalize_text(schedule.get("task_code") or schedule.get("taskCode"))


def schedule_experiment_code(schedule: Any) -> str:
    if not isinstance(schedule, dict):
        return ""
    return normalize_text(schedule.get("experiment_code") or schedule.get("experimentCode"))


def schedule_scope_value(schedule: Any, snake_key: str, camel_key: str) -> str:
    if not isinstance(schedule, dict):
        return ""
    return normalize_text(schedule.get(snake_key) or schedule.get(camel_key))


def schedule_axis_codes(schedule: Any) -> set[str]:
    if not isinstance(schedule, dict):
        return set()
    raw_codes = schedule.get("axis_codes") if "axis_codes" in schedule else schedule.get("axisCodes")
    return {normalize_text(code).lower() for code in as_list(raw_codes) if normalize_text(code)}


def schedules_duplicate_experiment_scope(left: Any, right: Any) -> bool:
    if schedule_task_code(left) != schedule_task_code(right) or schedule_experiment_code(left) != schedule_experiment_code(right):
        return False
    if not schedule_task_code(left) or not schedule_experiment_code(left):
        return False

    left_sub = schedule_scope_value(left, "sub_experiment_code", "subExperimentCode")
    right_sub = schedule_scope_value(right, "sub_experiment_code", "subExperimentCode")
    if left_sub or right_sub:
        return left_sub == right_sub

    left_batch = schedule_scope_value(left, "axis_batch_no", "axisBatchNo")
    right_batch = schedule_scope_value(right, "axis_batch_no", "axisBatchNo")
    if left_batch or right_batch:
        return left_batch == right_batch

    left_axes = schedule_axis_codes(left)
    right_axes = schedule_axis_codes(right)
    if left_axes or right_axes:
        return not left_axes or not right_axes or bool(left_axes & right_axes)

    return True


def validate_schedule_conflicts(next_schedules: list[dict[str, Any]], changed_schedules: list[dict[str, Any]]) -> None:
    for changed in changed_schedules:
        if schedule_targets_storage_area(changed) or schedule_is_completed(changed):
            continue
        changed_id = row_key(SCHEDULES_KEY, changed)
        if not changed_id:
            continue
        for existing in next_schedules:
            if row_key(SCHEDULES_KEY, existing) == changed_id:
                continue
            if schedule_targets_storage_area(existing) or schedule_is_completed(existing):
                continue
            if schedules_duplicate_experiment_scope(changed, existing):
                raise StorageSchedulePatchError("重复排程：该任务实验已存在排程，请刷新后再操作", status_code=409)
            if schedules_match_lab(changed, existing) and schedules_overlap(changed, existing):
                raise StorageSchedulePatchError("排程冲突，请调整时间或实验室", status_code=409)


def validate_schedule_maintenance_conflicts(
    schedules: list[dict[str, Any]],
    devices: list[dict[str, Any]],
    *,
    changed_devices: list[dict[str, Any]] | None = None,
    changed_schedules: list[dict[str, Any]] | None = None,
) -> None:
    def check_devices(device_candidates: list[dict[str, Any]]) -> None:
        for device in device_candidates:
            if not device_maintenance_window(device):
                continue
            for schedule in schedules:
                if schedule_targets_storage_area(schedule) or schedule_is_completed(schedule):
                    continue
                if schedule_matches_device(schedule, device) and schedule_overlaps_maintenance(schedule, device):
                    raise StorageSchedulePatchError(MAINTENANCE_SCHEDULE_CONFLICT_DETAIL, status_code=409)

    def check_schedules(schedule_candidates: list[dict[str, Any]]) -> None:
        for schedule in schedule_candidates:
            if schedule_targets_storage_area(schedule) or schedule_is_completed(schedule):
                continue
            for device in devices:
                if schedule_matches_device(schedule, device) and schedule_overlaps_maintenance(schedule, device):
                    raise StorageSchedulePatchError(SCHEDULE_MAINTENANCE_CONFLICT_DETAIL, status_code=409)

    if changed_devices is not None:
        check_devices(changed_devices)
    if changed_schedules is not None:
        check_schedules(changed_schedules)
    if changed_devices is not None or changed_schedules is not None:
        return

    check_schedules(schedules)
    check_devices(devices)


def normalize_patch(payload: dict[str, Any]) -> tuple[dict[str, list[dict[str, Any]]], dict[str, set[str]]]:
    upserts: dict[str, list[dict[str, Any]]] = {}
    deletes: dict[str, set[str]] = {}
    raw_upserts = payload.get("upserts") if isinstance(payload, dict) else {}
    raw_deletes = payload.get("deletes") if isinstance(payload, dict) else {}
    if isinstance(raw_upserts, dict):
        for key, rows in raw_upserts.items():
            if key not in PATCHABLE_KEYS:
                continue
            upserts[key] = [deepcopy(row) for row in as_list(rows) if isinstance(row, dict) and row_key(key, row)]
    if isinstance(raw_deletes, dict):
        for key, values in raw_deletes.items():
            if key not in PATCHABLE_KEYS:
                continue
            deletes[key] = {normalize_text(value) for value in as_list(values) if normalize_text(value)}
    return upserts, deletes


def apply_rows_patch(key: str, current_rows: Any, upsert_rows: list[dict[str, Any]], delete_keys: set[str]) -> list[dict[str, Any]]:
    current = [deepcopy(row) for row in as_list(current_rows) if isinstance(row, dict)]
    upsert_by_key = {row_key(key, row): deepcopy(row) for row in upsert_rows if row_key(key, row)}
    ordered_keys: list[str] = []
    for row in [*current, *upsert_rows]:
        item_key = row_key(key, row)
        if item_key and item_key not in ordered_keys:
            ordered_keys.append(item_key)

    patched: list[dict[str, Any]] = []
    current_by_key = {row_key(key, row): row for row in current if row_key(key, row)}
    for item_key in ordered_keys:
        if item_key in delete_keys:
            continue
        if item_key in upsert_by_key:
            patched.append(deepcopy(upsert_by_key[item_key]))
        elif item_key in current_by_key:
            patched.append(deepcopy(current_by_key[item_key]))
    return patched


def build_schedule_patch_updates(snapshot: dict[str, Any], payload: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    upserts, deletes = normalize_patch(payload)
    touched_keys = sorted(set(upserts) | set(deletes))
    if not touched_keys:
        raise StorageSchedulePatchError("No valid schedule patch rows provided", status_code=400)

    updates: dict[str, list[dict[str, Any]]] = {}
    for key in touched_keys:
        updates[key] = apply_rows_patch(key, snapshot.get(key), upserts.get(key, []), deletes.get(key, set()))

    if SCHEDULES_KEY in updates:
        validate_schedule_conflicts(updates[SCHEDULES_KEY], upserts.get(SCHEDULES_KEY, []))
        validate_schedule_maintenance_conflicts(
            updates[SCHEDULES_KEY],
            as_list(snapshot.get(DEVICES_KEY)),
            changed_schedules=upserts.get(SCHEDULES_KEY, []),
        )
    return updates
