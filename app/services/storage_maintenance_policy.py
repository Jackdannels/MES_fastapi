from typing import Any

from fastapi import HTTPException

from app.services.storage_schedule_patch import (
    StorageSchedulePatchError,
    validate_maintenance_time_order,
    validate_schedule_maintenance_conflicts,
)
from app.core.time_utils import now_business_datetime, parse_business_datetime
from app.services.storage_policies import LAB_MAINTENANCE_BLOCKED_STATUSES


def _text(value: Any) -> str:
    return str(value or "").strip()


def _rows(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _status(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    return _text(value.get("status")) or _text(value.get("flow_status"))


def _device_name(device: Any) -> str:
    if not isinstance(device, dict):
        return ""
    return _text(device.get("code")) or _text(device.get("name"))


def device_is_unavailable(device: Any) -> bool:
    if not isinstance(device, dict):
        return False
    status = _text(device.get("status"))
    start_at = parse_business_datetime(device.get("maintenance_start_at") or device.get("maintenanceStartAt"))
    end_at = parse_business_datetime(device.get("maintenance_end_at") or device.get("maintenanceEndAt"))
    now = now_business_datetime()
    if any(keyword in status for keyword in ["停用", "禁用", "不可用"]):
        return True
    if start_at:
        return bool(start_at <= now and (not end_at or now <= end_at))
    return any(keyword in status for keyword in ["维修", "保养"])


def _find_unavailable_device(devices: Any, lab_name: str) -> dict[str, Any] | None:
    normalized_lab = _text(lab_name)
    if not normalized_lab:
        return None
    for device in _rows(devices):
        if not isinstance(device, dict):
            continue
        if normalized_lab not in {_text(device.get("code")), _text(device.get("name"))}:
            continue
        if device_is_unavailable(device):
            return device
    return None


def validate_samples_maintenance_lock(current_samples: Any, next_samples: Any, devices: Any) -> None:
    if not isinstance(next_samples, list):
        return
    current_by_code = {
        _text(sample.get("code")): sample
        for sample in _rows(current_samples)
        if isinstance(sample, dict) and _text(sample.get("code"))
    }
    for next_sample in next_samples:
        if not isinstance(next_sample, dict):
            continue
        current_sample = current_by_code.get(_text(next_sample.get("code")))
        sample_statuses = {_text(next_sample.get("status")), _text(next_sample.get("flow_status"))}
        tray_statuses = {_status(tray) for tray in _rows(next_sample.get("trays")) if isinstance(tray, dict)}
        if not ((sample_statuses | tray_statuses) & LAB_MAINTENANCE_BLOCKED_STATUSES):
            continue
        current_statuses = {
            _text(current_sample.get("status")) if isinstance(current_sample, dict) else "",
            _text(current_sample.get("flow_status")) if isinstance(current_sample, dict) else "",
        }
        if isinstance(current_sample, dict):
            current_statuses.update(_status(tray) for tray in _rows(current_sample.get("trays")) if isinstance(tray, dict))
        current_location = _text(current_sample.get("location")) if isinstance(current_sample, dict) else ""
        next_location = _text(next_sample.get("location"))
        if next_location == current_location and (sample_statuses | tray_statuses) <= current_statuses:
            continue
        unavailable_device = _find_unavailable_device(devices, next_location)
        if unavailable_device:
            device_name = _device_name(unavailable_device) or next_location
            raise HTTPException(status_code=400, detail=f"{device_name}设备维修中，禁止实验室操作")


def _device_update_key(device: Any) -> str:
    if not isinstance(device, dict):
        return ""
    return str(device.get("code") or device.get("id") or device.get("lab_code") or device.get("labCode") or "").strip()


def _changed_device_rows(current_devices: Any, next_devices: Any) -> list[dict[str, Any]]:
    current_rows = current_devices if isinstance(current_devices, list) else []
    next_rows = next_devices if isinstance(next_devices, list) else []
    current_by_key = {
        _device_update_key(device): device
        for device in current_rows
        if isinstance(device, dict) and _device_update_key(device)
    }
    return [
        device
        for device in next_rows
        if isinstance(device, dict)
        and (not _device_update_key(device) or current_by_key.get(_device_update_key(device)) != device)
    ]


def validate_device_schedule_maintenance_conflicts(
    storage: Any,
    updates: dict[str, Any],
    current_snapshot: dict[str, Any] | None,
) -> None:
    if "mes.schedules" not in updates and "mes.devices" not in updates:
        return

    def read_current(key: str) -> Any:
        if current_snapshot is not None and key in current_snapshot:
            return current_snapshot[key]
        return storage.read(key)

    schedules = updates.get("mes.schedules", read_current("mes.schedules"))
    devices = updates.get("mes.devices", read_current("mes.devices"))
    changed_devices = None
    if "mes.devices" in updates:
        changed_devices = _changed_device_rows(read_current("mes.devices"), devices)
    try:
        if changed_devices is not None:
            validate_maintenance_time_order(changed_devices)
        validate_schedule_maintenance_conflicts(
            schedules if isinstance(schedules, list) else [],
            devices if isinstance(devices, list) else [],
            changed_devices=changed_devices,
            changed_schedules=updates.get("mes.schedules") if isinstance(updates.get("mes.schedules"), list) else None,
        )
    except StorageSchedulePatchError as error:
        raise HTTPException(status_code=error.status_code, detail=error.detail) from error
