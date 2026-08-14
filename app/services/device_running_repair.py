"""Atomic workflow for completing a running experiment before device repair."""

from typing import Any

from app.services.laboratory_completion import complete_storage_laboratory_experiment
from app.services.laboratory_snapshot_adapter import completion_updates, snapshot_from_storage_payload


RUNNING_EXPERIMENT_STATUSES = {"实验进行中", "实验中", "实验暂停"}


class DeviceRunningRepairError(ValueError):
    """Raised when a running-repair command no longer matches current storage state."""


def _text(value: Any) -> str:
    return str(value or "").strip()


def _device_key(device: Any) -> str:
    if not isinstance(device, dict):
        return ""
    return _text(device.get("code") or device.get("id") or device.get("lab_code") or device.get("labCode"))


def _device_aliases(device: dict[str, Any]) -> set[str]:
    return {
        value
        for value in (
            _device_key(device),
            _text(device.get("name")),
            _text(device.get("location")),
            _text(device.get("lab_name") or device.get("labName")),
        )
        if value
    }


def _record_lab(record: Any) -> str:
    if not isinstance(record, dict):
        return ""
    return _text(
        record.get("device")
        or record.get("lab_code")
        or record.get("labCode")
        or record.get("lab_name")
        or record.get("labName")
        or record.get("location")
    )


def _target_value(target: dict[str, Any], snake_name: str, camel_name: str) -> str:
    return _text(target.get(snake_name) or target.get(camel_name))


def _normalize_tray_codes(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return list(dict.fromkeys(_text(item) for item in value if _text(item)))


def _target_matches_device(
    storage_payload: dict[str, Any],
    *,
    aliases: set[str],
    experiment_code: str,
    run_no: str,
    schedule_id: str,
    task_code: str,
) -> bool:
    for run in storage_payload.get("mes.experiment_runs", []):
        if not isinstance(run, dict):
            continue
        if _text(run.get("task_code") or run.get("taskCode")) != task_code:
            continue
        if _text(run.get("experiment_code") or run.get("experimentCode")) != experiment_code:
            continue
        current_run_no = _text(run.get("run_no") or run.get("runNo") or run.get("id"))
        if run_no and current_run_no != run_no:
            continue
        if _text(run.get("status")) not in RUNNING_EXPERIMENT_STATUSES:
            continue
        if _record_lab(run) in aliases:
            return True

    for schedule in storage_payload.get("mes.schedules", []):
        if not isinstance(schedule, dict):
            continue
        if _text(schedule.get("task_code") or schedule.get("taskCode")) != task_code:
            continue
        if _text(schedule.get("experiment_code") or schedule.get("experimentCode")) != experiment_code:
            continue
        current_schedule_id = _text(schedule.get("id") or schedule.get("schedule_id") or schedule.get("scheduleId"))
        if schedule_id and current_schedule_id != schedule_id:
            continue
        if _text(schedule.get("status")) not in RUNNING_EXPERIMENT_STATUSES:
            continue
        if _record_lab(schedule) in aliases:
            return True
    return False


def build_completed_running_repair_updates(
    storage_payload: dict[str, Any],
    *,
    device_code: str,
    payload: dict[str, Any],
    completed_at: str,
) -> dict[str, Any]:
    """Complete the selected running scopes and enter repair in one snapshot update."""

    normalized_device_code = _text(device_code)
    devices = [dict(item) for item in storage_payload.get("mes.devices", []) if isinstance(item, dict)]
    device = next((item for item in devices if _device_key(item) == normalized_device_code), None)
    if device is None:
        raise DeviceRunningRepairError("未找到需要维修的设备")

    maintenance_type = _text(payload.get("maintenance_type") or payload.get("maintenanceType") or "维修")
    if maintenance_type != "维修":
        raise DeviceRunningRepairError("运行中设备仅支持立即维修")

    targets = payload.get("targets")
    if not isinstance(targets, list) or not targets:
        raise DeviceRunningRepairError("未找到正在进行的实验")

    aliases = _device_aliases(device)
    working_snapshot = snapshot_from_storage_payload(storage_payload)
    result: dict[str, Any] | None = None
    seen_scopes: set[tuple[str, str, str]] = set()
    for raw_target in targets:
        if not isinstance(raw_target, dict):
            continue
        task_code = _target_value(raw_target, "task_code", "taskCode")
        experiment_code = _target_value(raw_target, "experiment_code", "experimentCode")
        run_no = _target_value(raw_target, "run_no", "runNo")
        schedule_id = _target_value(raw_target, "schedule_id", "scheduleId") or _text(raw_target.get("id"))
        sub_experiment_code = _target_value(raw_target, "sub_experiment_code", "subExperimentCode")
        scope_key = (task_code, experiment_code, run_no or schedule_id)
        if not task_code or not experiment_code or scope_key in seen_scopes:
            continue
        if not _target_matches_device(
            storage_payload,
            aliases=aliases,
            experiment_code=experiment_code,
            run_no=run_no,
            schedule_id=schedule_id,
            task_code=task_code,
        ):
            raise DeviceRunningRepairError("当前实验状态已变化，请刷新后重试")
        seen_scopes.add(scope_key)
        tray_codes = _normalize_tray_codes(raw_target.get("tray_codes") or raw_target.get("trayCodes"))
        try:
            result = complete_storage_laboratory_experiment(
                working_snapshot,
                task_code=task_code,
                experiment_code=experiment_code,
                sub_experiment_code=sub_experiment_code,
                run_no=run_no,
                tray_codes=tray_codes,
                completed_at=completed_at,
            )
        except ValueError as error:
            raise DeviceRunningRepairError(str(error)) from error
        working_snapshot["samples"] = result["samples"]
        working_snapshot["experiments"] = result["experiments"]
        working_snapshot["schedules"] = result["schedules"]
        working_snapshot["experiment_runs"] = result["experimentRuns"]
        working_snapshot["experiment_run_trays"] = result["experimentRunTrays"]

    if result is None:
        raise DeviceRunningRepairError("未找到正在进行的实验")

    maintenance_note = _text(payload.get("maintenance_note") or payload.get("maintenanceNote"))
    next_devices = [
        {
            **item,
            "maintenance_end_at": "",
            "maintenance_note": maintenance_note,
            "maintenance_start_at": completed_at,
            "maintenance_type": "维修",
            "status": "维修",
            "updated_at": completed_at,
        }
        if _device_key(item) == normalized_device_code
        else item
        for item in devices
    ]
    return {
        **completion_updates(result),
        "mes.devices": next_devices,
    }


__all__ = ["DeviceRunningRepairError", "build_completed_running_repair_updates"]
