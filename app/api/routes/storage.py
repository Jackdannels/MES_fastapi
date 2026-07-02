import json
import queue
import threading
from datetime import datetime
from typing import Any, Dict

from fastapi import APIRouter, Body, Header, HTTPException
from fastapi.responses import StreamingResponse

from app.core.storage_backend import STORAGE_KEYS, get_storage_backend
from app.core.time_utils import now_business_datetime, now_business_text, parse_business_datetime
from app.services.appearance_inspection import (
    PRE_EXPERIMENT_APPEARANCE_STATUS,
    experiment_requires_appearance_inspection,
    pre_experiment_appearance_already_dispatched,
    should_route_pre_experiment_appearance,
    target_requires_appearance_inspection,
)
from app.services.laboratory_completion import tray_assigned_experiments_are_completed
from app.services.laboratory_operations import acquire_laboratory_storage_commit_lock
from app.services.experiment_segments import record_sub_experiment_code, resolve_record_sub_experiment_code
from app.services.storage_atomic import merge_concurrent_storage_updates
from app.services.storage_tray_actions import (
    SAMPLES_KEY,
    STAGING_EVENTS_KEY,
    StorageTrayActionError,
    build_manufacturer_return_updates,
    build_stock_in_updates,
    build_stock_out_updates,
    summarize_tray_row,
)
from app.services.storage_schedule_patch import StorageSchedulePatchError, build_schedule_patch_updates

router = APIRouter(prefix="/api/storage", tags=["storage"])

LAB_DISPATCHED_STATUS = "送至实验室"
LAB_ARRIVED_STATUS = "已到达实验室"
LAB_ARRIVAL_REQUIRES_DISPATCH_DETAIL = "托盘尚未从接驳间出库，不能直接到达实验室"
STAGING_STOCK_IN_BLOCKED_DETAIL = "该托盘已进入试验间流程，不能暂存间入库。"
APPEARANCE_STOCK_IN_BLOCKED_DETAIL = "该托盘已进入试验间流程，不能外观检测间入库。"
RETURNED_REARRIVAL_BLOCKED_DETAIL = "该托盘已厂家收回，不能再次到货。"
STAGING_LOCATION_KEYWORD = "暂存间"
POST_EXPERIMENT_STAGING_STOCKED_STATUS = "实验后暂存间存放"
STAGING_INBOUND_STATUSES = {
    "已到达暂存间",
    POST_EXPERIMENT_STAGING_STOCKED_STATUS,
}
APPEARANCE_LOCATION_KEYWORD = "外观检测间"
APPEARANCE_INBOUND_STATUSES = {"送至外观检测间", "实验后外观检测间存放", PRE_EXPERIMENT_APPEARANCE_STATUS}
APPEARANCE_SOURCE_REQUIRED_DETAIL = "当前试验类型不支持进入外观检测间。"
APPEARANCE_REPEAT_STOCK_IN_BLOCKED_DETAIL = "该托盘已完成实验前外观检测并出库，不能重复入库外观检测间。"
APPEARANCE_DISPATCH_TARGET_REQUIRED_DETAIL = "目标实验室与当前托盘不匹配"
RETURNED_STATUS = "厂家收回"
HANDOVER_ARRIVAL_STATUSES = {"到货"}
COMPLETED_EXPERIMENT_STATUSES = {"实验已完成", "实验完成", "实验已经完成"}
STAGING_STOCK_IN_BLOCKED_CURRENT_STATUSES = {
    LAB_DISPATCHED_STATUS,
    LAB_ARRIVED_STATUS,
    "工装夹具安装",
    "实验准备就绪",
    "实验进行中",
    "实验中",
}
LAB_MAINTENANCE_BLOCKED_STATUSES = {
    LAB_DISPATCHED_STATUS,
    LAB_ARRIVED_STATUS,
    "工装夹具安装",
    "实验准备就绪",
    "实验进行中",
    "实验中",
}
SCHEDULE_LOCKED_AFTER_FIXTURE_STATUSES = {
    "工装夹具安装",
    "实验准备就绪",
    "实验进行中",
    "实验中",
    *COMPLETED_EXPERIMENT_STATUSES,
}
SCHEDULE_FIXTURE_LOCKED_DETAIL = "夹具安装后排程不可删除或重新排程。"
SCHEDULE_LOCKED_FIELDS = {
    "device",
    "end_at",
    "experiment_code",
    "lab_code",
    "lab_id",
    "planned_hours",
    "start_at",
    "task_code",
}
_STORAGE_UPDATE_SUBSCRIBERS: set[queue.Queue[dict[str, Any]]] = set()
_STORAGE_UPDATE_SUBSCRIBERS_LOCK = threading.Lock()


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _parse_datetime(value: Any) -> datetime | None:
    return parse_business_datetime(value)


def _sample_code(sample: Any) -> str:
    return _normalize_text(sample.get("code")) if isinstance(sample, dict) else ""


def _tray_code(tray: Any) -> str:
    return _normalize_text(tray.get("tray_code")) if isinstance(tray, dict) else ""


def _task_code(row: Any) -> str:
    if not isinstance(row, dict):
        return ""
    return _normalize_text(row.get("task_code") or row.get("taskCode") or row.get("code"))


def _experiment_code(row: Any) -> str:
    if not isinstance(row, dict):
        return ""
    return _normalize_text(row.get("experiment_code") or row.get("experimentCode"))


def _status(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    return _normalize_text(value.get("status")) or _normalize_text(value.get("flow_status"))


def _schedule_id(schedule: Any) -> str:
    return _normalize_text(schedule.get("id")) if isinstance(schedule, dict) else ""


def _experiment_tray_codes(experiment_trays: Any, task_code: str, experiment_code: str) -> set[str]:
    codes: set[str] = set()
    for entry in _as_list(experiment_trays):
        if not isinstance(entry, dict):
            continue
        if _task_code(entry) != task_code or _experiment_code(entry) != experiment_code:
            continue
        tray_code = _tray_code(entry)
        if tray_code:
            codes.add(tray_code)
    return codes


def _sample_has_fixture_locked_tray(sample: Any, tray_codes: set[str]) -> bool:
    if not isinstance(sample, dict):
        return False
    sample_statuses = {
        _normalize_text(sample.get("status")),
        _normalize_text(sample.get("flow_status")),
    }
    for tray in _as_list(sample.get("trays")):
        if not isinstance(tray, dict) or _tray_code(tray) not in tray_codes:
            continue
        tray_statuses = {_normalize_text(tray.get("status")), _normalize_text(tray.get("flow_status"))}
        if (sample_statuses | tray_statuses) & SCHEDULE_LOCKED_AFTER_FIXTURE_STATUSES:
            return True
    return False


def _record_axis_batch_no(record: Any) -> str:
    return _normalize_text(record.get("axis_batch_no") or record.get("axisBatchNo")) if isinstance(record, dict) else ""


def _record_axis_codes(record: Any) -> list[str]:
    if not isinstance(record, dict):
        return []
    return _normalize_axis_codes(record.get("axis_codes") or record.get("axisCodes"))


def _schedule_has_axis_scope(schedule: Any) -> bool:
    if not isinstance(schedule, dict):
        return False
    experiment_code = _experiment_code(schedule)
    return bool(_record_sub_code(schedule, experiment_code=experiment_code) or _record_axis_batch_no(schedule) or _record_axis_codes(schedule))


def _record_has_schedule_locked_status(record: Any) -> bool:
    if not isinstance(record, dict):
        return False
    statuses = {
        _normalize_text(record.get("status")),
        _normalize_text(record.get("schedule_status")),
        _normalize_text(record.get("run_tray_status")),
        _normalize_text(record.get("experiment_status")),
    }
    return bool(statuses & SCHEDULE_LOCKED_AFTER_FIXTURE_STATUSES)


def _record_matches_schedule_scope(record: Any, schedule: Any, *, allow_legacy_experiment_fallback: bool = False) -> bool:
    if not isinstance(record, dict) or not isinstance(schedule, dict):
        return False
    task_code = _task_code(schedule)
    experiment_code = _experiment_code(schedule)
    if _task_code(record) != task_code or _experiment_code(record) != experiment_code:
        return False

    schedule_id = _schedule_id(schedule)
    record_schedule_id = _record_schedule_id(record)
    if schedule_id and record_schedule_id:
        return schedule_id == record_schedule_id

    schedule_sub_code = _record_sub_code(schedule, experiment_code=experiment_code)
    record_sub_code = _record_sub_code(record, experiment_code=experiment_code)
    if schedule_sub_code and record_sub_code:
        return schedule_sub_code == record_sub_code

    schedule_axis_batch_no = _record_axis_batch_no(schedule)
    record_axis_batch_no = _record_axis_batch_no(record)
    if schedule_axis_batch_no and record_axis_batch_no:
        return schedule_axis_batch_no == record_axis_batch_no

    schedule_axis_codes = set(_record_axis_codes(schedule))
    record_axis_codes = set(_record_axis_codes(record))
    if schedule_axis_codes and record_axis_codes:
        return bool(schedule_axis_codes & record_axis_codes)

    schedule_scoped = bool(schedule_sub_code or schedule_axis_batch_no or schedule_axis_codes)
    record_scoped = bool(record_schedule_id or record_sub_code or record_axis_batch_no or record_axis_codes)
    if schedule_scoped or record_scoped:
        return False

    return allow_legacy_experiment_fallback


def _schedule_has_started_record(schedule: Any, experiment_runs: Any, experiment_run_trays: Any) -> bool:
    if not isinstance(schedule, dict):
        return False
    if _record_has_schedule_locked_status(schedule):
        return True

    matching_run_nos: set[str] = set()
    for run in _as_list(experiment_runs):
        if (
            isinstance(run, dict)
            and _record_has_schedule_locked_status(run)
            and _record_matches_schedule_scope(run, schedule, allow_legacy_experiment_fallback=True)
        ):
            run_no = _run_no(run)
            if run_no:
                matching_run_nos.add(run_no)
            return True

    for relation in _as_list(experiment_run_trays):
        if not isinstance(relation, dict) or not _record_has_schedule_locked_status(relation):
            continue
        run_no = _run_no(relation)
        if (run_no and run_no in matching_run_nos) or _record_matches_schedule_scope(relation, schedule):
            return True
    return False


def _schedule_is_fixture_locked(
    schedule: Any,
    samples: Any,
    experiment_trays: Any,
    experiment_runs: Any = None,
    experiment_run_trays: Any = None,
) -> bool:
    if not isinstance(schedule, dict):
        return False
    task_code = _task_code(schedule)
    experiment_code = _experiment_code(schedule)
    if not task_code or not experiment_code:
        return False
    if _schedule_has_started_record(schedule, experiment_runs, experiment_run_trays):
        return True
    if _schedule_has_axis_scope(schedule):
        return False
    tray_codes = _experiment_tray_codes(experiment_trays, task_code, experiment_code)
    if not tray_codes:
        return False
    return any(
        _task_code(sample) == task_code and _sample_has_fixture_locked_tray(sample, tray_codes)
        for sample in _as_list(samples)
    )


def _normalize_axis_codes(value: Any) -> list[str]:
    if isinstance(value, list):
        raw_values = value
    elif isinstance(value, str):
        raw_values = value.replace("，", ",").split(",")
    else:
        raw_values = []
    axis_codes: list[str] = []
    seen: set[str] = set()
    for item in raw_values:
        axis_code = _normalize_text(item)
        if not axis_code or axis_code in seen:
            continue
        seen.add(axis_code)
        axis_codes.append(axis_code)
    return axis_codes


def _is_partially_completed_multi_axis_schedule(schedule: Any, experiment_run_steps: Any) -> bool:
    if not isinstance(schedule, dict):
        return False
    axis_codes = _normalize_axis_codes(schedule.get("axis_codes") or schedule.get("axisCodes"))
    if len(axis_codes) < 2:
        return False
    axis_code_set = set(axis_codes)
    task_code = _task_code(schedule)
    experiment_code = _experiment_code(schedule)
    sub_experiment_code = _record_sub_code(schedule, experiment_code=experiment_code)
    if not sub_experiment_code:
        return False
    completed_axis_codes = {
        _normalize_text(step.get("axis_code") or step.get("axisCode"))
        for step in _as_list(experiment_run_steps)
        if isinstance(step, dict)
        and _task_code(step) == task_code
        and _experiment_code(step) == experiment_code
        and record_sub_experiment_code(step) == sub_experiment_code
        and _normalize_text(step.get("status")) in COMPLETED_EXPERIMENT_STATUSES
        and _normalize_text(step.get("axis_code") or step.get("axisCode")) in axis_code_set
    }
    return bool(completed_axis_codes) and not axis_code_set.issubset(completed_axis_codes)


def _run_no(record: Any) -> str:
    return _normalize_text(record.get("run_no") or record.get("runNo") or record.get("id")) if isinstance(record, dict) else ""


def _record_schedule_id(record: Any) -> str:
    return _normalize_text(record.get("schedule_id") or record.get("scheduleId") or record.get("schedule_no")) if isinstance(record, dict) else ""


def _is_completed_status(value: Any) -> bool:
    return _normalize_text(value) in COMPLETED_EXPERIMENT_STATUSES


def _record_sub_code(record: Any, *, experiment_code: str = "") -> str:
    if not isinstance(record, dict):
        return ""
    return resolve_record_sub_experiment_code(record, experiment_code=experiment_code)


def tray_has_scoped_partial_axis_batch_completion(
    *,
    task_code: str,
    tray_code: str,
    experiments: list[dict[str, Any]] | None = None,
    experiment_runs: list[dict[str, Any]] | None = None,
    experiment_run_steps: list[dict[str, Any]] | None = None,
    experiment_run_trays: list[dict[str, Any]] | None = None,
    experiment_trays: list[dict[str, Any]] | None = None,
    schedules: list[dict[str, Any]] | None = None,
) -> bool:
    normalized_task_code = _normalize_text(task_code)
    normalized_tray_code = _normalize_text(tray_code)
    run_by_no = {
        _run_no(run): run
        for run in _as_list(experiment_runs)
        if isinstance(run, dict) and _task_code(run) == normalized_task_code and _run_no(run)
    }
    schedule_by_id = {
        _schedule_id(schedule): schedule
        for schedule in _as_list(schedules)
        if isinstance(schedule, dict) and _schedule_id(schedule)
    }
    completed_steps_by_run: dict[str, set[str]] = {}
    for step in _as_list(experiment_run_steps):
        if not isinstance(step, dict) or _task_code(step) != normalized_task_code:
            continue
        if not _is_completed_status(step.get("status")):
            continue
        axis_code = _normalize_text(step.get("axis_code") or step.get("axisCode"))
        if not axis_code:
            continue
        completed_steps_by_run.setdefault(_run_no(step), set()).add(axis_code)

    completed_batches: dict[str, list[dict[str, Any]]] = {}
    for relation in _as_list(experiment_run_trays):
        if not isinstance(relation, dict):
            continue
        if _task_code(relation) != normalized_task_code or _normalize_text(relation.get("tray_code") or relation.get("tray_no")) != normalized_tray_code:
            continue
        if not _is_completed_status(relation.get("status") or relation.get("run_tray_status")):
            continue
        experiment_code = _experiment_code(relation)
        run_no = _run_no(relation)
        run = run_by_no.get(run_no)
        if not experiment_code or not run or not _is_completed_status(run.get("status")):
            continue
        axes = set(completed_steps_by_run.get(run_no, set()))
        axes.update(_normalize_axis_codes(run.get("axis_codes") or run.get("axisCodes")))
        if not axes:
            continue
        run_schedule = schedule_by_id.get(_record_schedule_id(run))
        sub_code = record_sub_experiment_code(relation) or record_sub_experiment_code(run)
        if not sub_code and run_schedule:
            sub_code = _record_sub_code(run_schedule, experiment_code=experiment_code)
        if not sub_code:
            continue
        completed_batches.setdefault(experiment_code, []).append(
            {
                "axes": axes,
                "schedule_id": _record_schedule_id(run),
                "sub_experiment_code": sub_code,
            }
        )

    for schedule in _as_list(schedules):
        if not isinstance(schedule, dict) or _task_code(schedule) != normalized_task_code:
            continue
        if _is_completed_status(schedule.get("status") or schedule.get("schedule_status")):
            continue
        experiment_code = _experiment_code(schedule)
        pending_axes = set(_normalize_axis_codes(schedule.get("axis_codes") or schedule.get("axisCodes")))
        if not experiment_code or not pending_axes:
            continue
        schedule_id = _schedule_id(schedule)
        schedule_sub_code = _record_sub_code(schedule, experiment_code=experiment_code)
        if not schedule_sub_code:
            continue
        for completed_batch in completed_batches.get(experiment_code, []):
            if schedule_id and schedule_id == completed_batch["schedule_id"]:
                continue
            if schedule_sub_code == completed_batch["sub_experiment_code"]:
                continue
            if pending_axes - completed_batch["axes"]:
                return True
    return False


def _locked_schedule_fields_changed(current_schedule: Any, next_schedule: Any) -> bool:
    if not isinstance(current_schedule, dict) or not isinstance(next_schedule, dict):
        return True
    return any(
        _normalize_text(current_schedule.get(field)) != _normalize_text(next_schedule.get(field))
        for field in SCHEDULE_LOCKED_FIELDS
    )


def _experiment_name_by_code(experiments: Any) -> dict[str, str]:
    names: dict[str, str] = {}
    for experiment in _as_list(experiments):
        if not isinstance(experiment, dict):
            continue
        code = _normalize_text(experiment.get("experiment_code") or experiment.get("experiment_no"))
        if not code:
            continue
        names[code] = (
            _normalize_text(experiment.get("experiment_name"))
            or _normalize_text(experiment.get("experiment_type"))
            or _normalize_text(experiment.get("test_type"))
            or _normalize_text(experiment.get("required_device"))
        )
    return names


def _run_trays_have_allowed_appearance_source(
    sample: Any,
    tray: Any,
    experiments: Any,
    experiment_run_trays: Any,
) -> bool:
    task_code = _normalize_text(sample.get("task_code") or sample.get("task_no")) if isinstance(sample, dict) else ""
    tray_code = _tray_code(tray)
    if not task_code or not tray_code:
        return False
    experiment_names = _experiment_name_by_code(experiments)
    for entry in _as_list(experiment_run_trays):
        if not isinstance(entry, dict):
            continue
        if (
            _normalize_text(entry.get("task_code") or entry.get("task_no")) != task_code
            or _normalize_text(entry.get("tray_code") or entry.get("tray_no")) != tray_code
            or _normalize_text(entry.get("status") or entry.get("run_tray_status")) not in COMPLETED_EXPERIMENT_STATUSES
        ):
            continue
        experiment_code = _normalize_text(entry.get("experiment_code") or entry.get("experiment_no"))
        experiment_name = (
            experiment_names.get(experiment_code, "")
            or _normalize_text(entry.get("experiment_name"))
            or experiment_code
        )
        if experiment_requires_appearance_inspection(experiment_name):
            return True
    return False


def _tray_has_allowed_appearance_source(
    current_sample: Any,
    next_sample: Any,
    current_tray: Any,
    next_tray: Any,
    experiments: Any,
    experiment_run_trays: Any,
) -> bool:
    return (
        _run_trays_have_allowed_appearance_source(current_sample, current_tray, experiments, experiment_run_trays)
        or _run_trays_have_allowed_appearance_source(next_sample, next_tray, experiments, experiment_run_trays)
    )


def _tray_has_allowed_pre_experiment_appearance_target(
    current_sample: Any,
    next_tray: Any,
    experiments: Any,
    current_tray: Any = None,
) -> bool:
    if not isinstance(current_sample, dict) or not isinstance(next_tray, dict):
        return False
    source_status = _status(current_tray) if isinstance(current_tray, dict) else ""
    if not source_status:
        source_status = _normalize_text(current_sample.get("status")) or _normalize_text(current_sample.get("flow_status"))
    return should_route_pre_experiment_appearance(
        source_location=_normalize_text(current_sample.get("location")),
        source_status=source_status,
        target_lab=_normalize_text(next_tray.get("target_lab") or next_tray.get("targetLab")),
        target_experiment_code=_normalize_text(
            next_tray.get("target_experiment_code")
            or next_tray.get("targetExperimentCode")
            or next_tray.get("experiment_code")
            or next_tray.get("experimentCode")
        ),
        experiments=experiments,
    )


def _tray_has_allowed_dispatched_pre_experiment_appearance_target(
    current_sample: Any,
    next_tray: Any,
    experiments: Any,
    current_tray: Any = None,
) -> bool:
    if not isinstance(current_sample, dict) or not isinstance(next_tray, dict):
        return False
    current_statuses = {
        _normalize_text(current_sample.get("status")),
        _normalize_text(current_sample.get("flow_status")),
    }
    if isinstance(current_tray, dict):
        current_statuses.add(_status(current_tray))
    if LAB_DISPATCHED_STATUS not in current_statuses:
        return False

    target_lab = (
        _normalize_text(next_tray.get("target_lab") or next_tray.get("targetLab"))
        or (
            _normalize_text(current_tray.get("target_lab") or current_tray.get("targetLab"))
            if isinstance(current_tray, dict)
            else ""
        )
    )
    target_experiment_code = (
        _normalize_text(
            next_tray.get("target_experiment_code")
            or next_tray.get("targetExperimentCode")
            or next_tray.get("experiment_code")
            or next_tray.get("experimentCode")
        )
        or (
            _normalize_text(
                current_tray.get("target_experiment_code")
                or current_tray.get("targetExperimentCode")
                or current_tray.get("experiment_code")
                or current_tray.get("experimentCode")
            )
            if isinstance(current_tray, dict)
            else ""
        )
    )
    return target_requires_appearance_inspection(
        target_lab=target_lab,
        target_experiment_code=target_experiment_code,
        experiments=experiments,
    )


def _pre_experiment_appearance_already_dispatched(current_sample: Any, current_tray: Any, staging_events: Any) -> bool:
    return pre_experiment_appearance_already_dispatched(current_sample, current_tray, staging_events)


def _is_pre_experiment_appearance_inbound(sample: Any, tray: Any | None = None) -> bool:
    if not isinstance(sample, dict):
        return False
    if isinstance(tray, dict):
        return _status(tray) == PRE_EXPERIMENT_APPEARANCE_STATUS and APPEARANCE_LOCATION_KEYWORD in _normalize_text(sample.get("location"))
    statuses = {
        _normalize_text(sample.get("status")),
        _normalize_text(sample.get("flow_status")),
    }
    return PRE_EXPERIMENT_APPEARANCE_STATUS in statuses and APPEARANCE_LOCATION_KEYWORD in _normalize_text(sample.get("location"))


def _appearance_inbound_state_changed(current_sample: Any, next_sample: Any, current_tray: Any, next_tray: Any) -> bool:
    current_values = {
        _normalize_text(current_sample.get("location")) if isinstance(current_sample, dict) else "",
        _normalize_text(current_sample.get("status")) if isinstance(current_sample, dict) else "",
        _normalize_text(current_sample.get("flow_status")) if isinstance(current_sample, dict) else "",
        _status(current_tray),
    }
    next_values = {
        _normalize_text(next_sample.get("location")) if isinstance(next_sample, dict) else "",
        _normalize_text(next_sample.get("status")) if isinstance(next_sample, dict) else "",
        _normalize_text(next_sample.get("flow_status")) if isinstance(next_sample, dict) else "",
        _status(next_tray),
    }
    return current_values != next_values


def _device_name(device: Any) -> str:
    if not isinstance(device, dict):
        return ""
    return _normalize_text(device.get("code")) or _normalize_text(device.get("name"))


def _device_is_unavailable(device: Any) -> bool:
    if not isinstance(device, dict):
        return False
    status = _normalize_text(device.get("status"))
    start_at = _parse_datetime(device.get("maintenance_start_at") or device.get("maintenanceStartAt"))
    end_at = _parse_datetime(device.get("maintenance_end_at") or device.get("maintenanceEndAt"))
    now = now_business_datetime()
    if any(keyword in status for keyword in ["停用", "禁用", "不可用"]):
        return True
    if any(keyword in status for keyword in ["维护", "维修", "保养"]) and not (end_at and end_at < now):
        return True
    return bool(start_at and start_at <= now and (not end_at or now <= end_at))


def _find_unavailable_device(devices: Any, lab_name: str) -> dict[str, Any] | None:
    normalized_lab = _normalize_text(lab_name)
    if not normalized_lab:
        return None
    for device in _as_list(devices):
        if not isinstance(device, dict):
            continue
        if normalized_lab not in {_normalize_text(device.get("code")), _normalize_text(device.get("name"))}:
            continue
        if _device_is_unavailable(device):
            return device
    return None


def _sample_was_dispatched(sample: Any) -> bool:
    if not isinstance(sample, dict):
        return False
    return LAB_DISPATCHED_STATUS in {
        _normalize_text(sample.get("status")),
        _normalize_text(sample.get("flow_status")),
    }


def _sample_was_lab_arrived(sample: Any) -> bool:
    if not isinstance(sample, dict):
        return False
    return LAB_ARRIVED_STATUS in {
        _normalize_text(sample.get("status")),
        _normalize_text(sample.get("flow_status")),
    }


def _sample_was_completed_experiment(sample: Any) -> bool:
    if not isinstance(sample, dict):
        return False
    return bool(
        {
            _normalize_text(sample.get("status")),
            _normalize_text(sample.get("flow_status")),
        }
        & COMPLETED_EXPERIMENT_STATUSES
    )


def _sample_has_lab_arrival_history(sample: Any) -> bool:
    if not isinstance(sample, dict):
        return False
    for entry in _as_list(sample.get("history")):
        if not isinstance(entry, dict):
            continue
        if LAB_ARRIVED_STATUS in {
            _normalize_text(entry.get("status")),
            _normalize_text(entry.get("flow_status")),
        }:
            return True
        if LAB_ARRIVED_STATUS in _normalize_text(entry.get("detail")):
            return True
    return False


def _tray_was_dispatched(sample: Any, tray: Any) -> bool:
    return _status(tray) == LAB_DISPATCHED_STATUS or _sample_was_dispatched(sample)


def _tray_was_lab_arrived(sample: Any, tray: Any) -> bool:
    return _status(tray) == LAB_ARRIVED_STATUS or _sample_was_lab_arrived(sample)


def _tray_was_completed_experiment(sample: Any, tray: Any) -> bool:
    return _status(tray) in COMPLETED_EXPERIMENT_STATUSES or _sample_was_completed_experiment(sample)


def _sample_has_blocked_lab_status(sample: Any) -> bool:
    if not isinstance(sample, dict):
        return False
    return bool(
        {
            _normalize_text(sample.get("status")),
            _normalize_text(sample.get("flow_status")),
        }
        & STAGING_STOCK_IN_BLOCKED_CURRENT_STATUSES
    )


def _tray_has_blocked_lab_status(sample: Any, tray: Any) -> bool:
    if isinstance(tray, dict):
        return _status(tray) in STAGING_STOCK_IN_BLOCKED_CURRENT_STATUSES
    return _sample_has_blocked_lab_status(sample)


def _sample_was_returned(sample: Any) -> bool:
    if not isinstance(sample, dict):
        return False
    return RETURNED_STATUS in {
        _normalize_text(sample.get("status")),
        _normalize_text(sample.get("flow_status")),
        _normalize_text(sample.get("location")),
    }


def _tray_was_returned(sample: Any, tray: Any) -> bool:
    return _status(tray) == RETURNED_STATUS or _sample_was_returned(sample)


def _is_handover_arrival(sample: Any, tray: Any | None = None) -> bool:
    if not isinstance(sample, dict):
        return False
    statuses = {
        _normalize_text(sample.get("status")),
        _normalize_text(sample.get("flow_status")),
    }
    if isinstance(tray, dict):
        statuses.add(_status(tray))
    return bool(statuses & HANDOVER_ARRIVAL_STATUSES)


def _is_staging_inbound(sample: Any, tray: Any | None = None) -> bool:
    if not isinstance(sample, dict):
        return False
    statuses = {
        _normalize_text(sample.get("status")),
        _normalize_text(sample.get("flow_status")),
    }
    if isinstance(tray, dict):
        statuses.add(_status(tray))
    return bool(statuses & STAGING_INBOUND_STATUSES) or STAGING_LOCATION_KEYWORD in _normalize_text(sample.get("location"))


def _is_appearance_inbound(sample: Any, tray: Any | None = None) -> bool:
    if not isinstance(sample, dict):
        return False
    if isinstance(tray, dict):
        return _status(tray) in APPEARANCE_INBOUND_STATUSES
    statuses = {
        _normalize_text(sample.get("status")),
        _normalize_text(sample.get("flow_status")),
    }
    return bool(statuses & APPEARANCE_INBOUND_STATUSES)


def _is_storage_room_inbound(sample: Any, tray: Any | None = None) -> bool:
    return _is_staging_inbound(sample, tray) or _is_appearance_inbound(sample, tray)


def _tray_is_staging_inbound(tray: Any) -> bool:
    return isinstance(tray, dict) and _status(tray) in STAGING_INBOUND_STATUSES


def _tray_is_appearance_inbound(tray: Any) -> bool:
    return isinstance(tray, dict) and _status(tray) in APPEARANCE_INBOUND_STATUSES


def _tray_is_storage_room_inbound(tray: Any) -> bool:
    return _tray_is_staging_inbound(tray) or _tray_is_appearance_inbound(tray)


def _stock_in_blocked_detail(sample: Any, tray: Any | None = None) -> str:
    if _tray_is_appearance_inbound(tray) or (not isinstance(tray, dict) and _is_appearance_inbound(sample, tray)):
        return APPEARANCE_STOCK_IN_BLOCKED_DETAIL
    return STAGING_STOCK_IN_BLOCKED_DETAIL


def _is_post_experiment_staging_inbound(sample: Any, tray: Any | None = None) -> bool:
    if not isinstance(sample, dict):
        return False
    statuses = {
        _normalize_text(sample.get("status")),
        _normalize_text(sample.get("flow_status")),
    }
    if isinstance(tray, dict):
        statuses.add(_status(tray))
    location = _normalize_text(sample.get("location"))
    return (
        POST_EXPERIMENT_STAGING_STOCKED_STATUS in statuses
        or "实验后暂存间" in location
    )


def _is_post_experiment_staging_stored(sample: Any, tray: Any | None = None) -> bool:
    if not isinstance(sample, dict):
        return False
    statuses = {
        _normalize_text(sample.get("status")),
        _normalize_text(sample.get("flow_status")),
    }
    if isinstance(tray, dict):
        statuses.add(_status(tray))
    return POST_EXPERIMENT_STAGING_STOCKED_STATUS in statuses or "实验后暂存间" in _normalize_text(sample.get("location"))


def _is_appearance_stored(sample: Any, tray: Any | None = None) -> bool:
    if not isinstance(sample, dict):
        return False
    statuses = {
        _normalize_text(sample.get("status")),
        _normalize_text(sample.get("flow_status")),
    }
    if isinstance(tray, dict):
        statuses.add(_status(tray))
    return bool(statuses & {"实验后外观检测间存放", PRE_EXPERIMENT_APPEARANCE_STATUS})


def _latest_storage_event_for_tray(staging_events: Any, tray_code: str) -> dict[str, Any] | None:
    normalized_tray_code = _normalize_text(tray_code)
    latest_event: dict[str, Any] | None = None
    latest_key: tuple[datetime, int] | None = None
    for index, event in enumerate(_as_list(staging_events)):
        if not isinstance(event, dict) or _normalize_text(event.get("tray_code")) != normalized_tray_code:
            continue
        event_time = _parse_datetime(event.get("time") or event.get("created_at") or event.get("updated_at")) or datetime.min
        event_key = (event_time, index)
        if latest_key is None or event_key > latest_key:
            latest_key = event_key
            latest_event = event
    return latest_event


def _event_targets_staging(event: Any) -> bool:
    if not isinstance(event, dict):
        return False
    target_type = _normalize_text(event.get("target_type") or event.get("targetType"))
    target_text = " ".join(
        value
        for value in (
            _normalize_text(event.get("target_lab") or event.get("targetLab")),
            _normalize_text(event.get("target_name") or event.get("targetName")),
        )
        if value
    )
    return target_type == "staging" or STAGING_LOCATION_KEYWORD in target_text


def _has_latest_appearance_dispatch_to_staging(staging_events: Any, tray_code: str) -> bool:
    latest_event = _latest_storage_event_for_tray(staging_events, tray_code)
    if not latest_event:
        return False
    room = _normalize_text(latest_event.get("room") or latest_event.get("storage_room") or latest_event.get("storageRoom"))
    return (
        room == "appearance"
        and _normalize_text(latest_event.get("action")) == "stock_out"
        and _event_targets_staging(latest_event)
    )


def _is_lab_dispatch_outbound(sample: Any, tray: Any) -> bool:
    if not isinstance(sample, dict):
        return False
    statuses = {
        _normalize_text(sample.get("status")),
        _normalize_text(sample.get("flow_status")),
    }
    if isinstance(tray, dict):
        statuses.add(_status(tray))
    return LAB_DISPATCHED_STATUS in statuses


def _appearance_dispatch_target_is_allowed(next_sample: Any, next_tray: Any, experiments: Any) -> bool:
    if not isinstance(next_sample, dict) or not isinstance(next_tray, dict):
        return True
    target_type = _normalize_text(next_tray.get("target_type") or next_tray.get("targetType"))
    if target_type == "staging":
        return True
    target_lab = (
        _normalize_text(next_tray.get("target_lab") or next_tray.get("targetLab"))
        or _normalize_text(next_sample.get("location"))
    )
    target_experiment_code = _normalize_text(
        next_tray.get("target_experiment_code")
        or next_tray.get("targetExperimentCode")
    )
    return target_requires_appearance_inspection(
        target_lab=target_lab,
        target_experiment_code=target_experiment_code,
        experiments=experiments,
    )


def _validate_samples_appearance_dispatch_transition(
    current_samples: Any,
    next_samples: Any,
    experiments: Any,
) -> None:
    if not isinstance(next_samples, list):
        return

    current_by_code = _index_samples(current_samples)
    if not current_by_code:
        return

    for next_sample in next_samples:
        if not isinstance(next_sample, dict):
            continue
        current_sample = current_by_code.get(_sample_code(next_sample))
        if not current_sample:
            continue

        current_trays = _index_trays(current_sample)
        for next_tray in _as_list(next_sample.get("trays")):
            if not isinstance(next_tray, dict):
                continue
            current_tray = current_trays.get(_tray_code(next_tray))
            if not _is_pre_experiment_appearance_inbound(current_sample, current_tray):
                continue
            if not _is_lab_dispatch_outbound(next_sample, next_tray):
                continue
            if not _appearance_dispatch_target_is_allowed(next_sample, next_tray, experiments):
                raise HTTPException(status_code=400, detail=APPEARANCE_DISPATCH_TARGET_REQUIRED_DETAIL)


def _post_staging_reentry_is_completed(
    sample: Any,
    tray: Any,
    experiments: Any,
    experiment_runs: Any,
    experiment_run_steps: Any,
    experiment_trays: Any,
    experiment_run_trays: Any,
    schedules: Any,
) -> bool:
    if not isinstance(sample, dict) or not isinstance(tray, dict):
        return False
    task_code = _normalize_text(sample.get("task_code") or sample.get("task_no"))
    tray_code = _tray_code(tray)
    normalized_experiments = [item for item in _as_list(experiments) if isinstance(item, dict)]
    normalized_experiment_runs = [item for item in _as_list(experiment_runs) if isinstance(item, dict)]
    normalized_experiment_run_steps = [item for item in _as_list(experiment_run_steps) if isinstance(item, dict)]
    normalized_experiment_trays = [item for item in _as_list(experiment_trays) if isinstance(item, dict)]
    normalized_experiment_run_trays = [item for item in _as_list(experiment_run_trays) if isinstance(item, dict)]
    normalized_schedules = [item for item in _as_list(schedules) if isinstance(item, dict)]
    if tray_has_scoped_partial_axis_batch_completion(
        task_code=task_code,
        tray_code=tray_code,
        experiments=normalized_experiments,
        experiment_runs=normalized_experiment_runs,
        experiment_run_steps=normalized_experiment_run_steps,
        experiment_trays=normalized_experiment_trays,
        experiment_run_trays=normalized_experiment_run_trays,
        schedules=normalized_schedules,
    ):
        return True
    assigned_experiment_codes = {
        _experiment_code(item)
        for item in normalized_experiment_trays
        if _task_code(item) == task_code
        and _normalize_text(item.get("tray_code") or item.get("tray_no")) == tray_code
        and _experiment_code(item)
    }
    axis_aware_experiment_codes = {
        _experiment_code(item)
        for item in normalized_experiments
        if _task_code(item) == task_code
        and _experiment_code(item) in assigned_experiment_codes
        and _normalize_axis_codes(item.get("axis_codes") or item.get("axisCodes"))
    }
    axis_aware_experiment_codes.update(
        _experiment_code(item)
        for item in normalized_schedules
        if _task_code(item) == task_code
        and _experiment_code(item) in assigned_experiment_codes
        and _normalize_axis_codes(item.get("axis_codes") or item.get("axisCodes"))
    )
    if axis_aware_experiment_codes:
        return _tray_axis_aware_experiments_are_completed(
            task_code=task_code,
            tray_code=tray_code,
            axis_aware_experiment_codes=axis_aware_experiment_codes,
            assigned_experiment_codes=assigned_experiment_codes,
            schedules=normalized_schedules,
            experiment_run_trays=normalized_experiment_run_trays,
        )
    return tray_assigned_experiments_are_completed(
        task_code=task_code,
        tray_code=tray_code,
        experiment_trays=normalized_experiment_trays,
        experiment_run_trays=normalized_experiment_run_trays,
    )


def _normal_staging_reentry_is_partial_axis_batch(
    sample: Any,
    tray: Any,
    experiments: Any,
    experiment_runs: Any,
    experiment_run_steps: Any,
    experiment_trays: Any,
    experiment_run_trays: Any,
    schedules: Any,
) -> bool:
    if not isinstance(sample, dict) or not isinstance(tray, dict):
        return False
    return tray_has_scoped_partial_axis_batch_completion(
        task_code=_normalize_text(sample.get("task_code") or sample.get("task_no")),
        tray_code=_tray_code(tray),
        experiments=[item for item in _as_list(experiments) if isinstance(item, dict)],
        experiment_runs=[item for item in _as_list(experiment_runs) if isinstance(item, dict)],
        experiment_run_steps=[item for item in _as_list(experiment_run_steps) if isinstance(item, dict)],
        experiment_trays=[item for item in _as_list(experiment_trays) if isinstance(item, dict)],
        experiment_run_trays=[item for item in _as_list(experiment_run_trays) if isinstance(item, dict)],
        schedules=[item for item in _as_list(schedules) if isinstance(item, dict)],
    )


def _tray_axis_aware_experiments_are_completed(
    *,
    task_code: str,
    tray_code: str,
    axis_aware_experiment_codes: set[str],
    assigned_experiment_codes: set[str],
    schedules: list[dict[str, Any]],
    experiment_run_trays: list[dict[str, Any]],
) -> bool:
    if not axis_aware_experiment_codes:
        return False
    completed_by_experiment: dict[str, set[str]] = {}
    completed_non_axis_experiment_codes: set[str] = set()
    for relation in experiment_run_trays:
        if (
            _task_code(relation) != task_code
            or _normalize_text(relation.get("tray_code") or relation.get("tray_no")) != tray_code
            or not _is_completed_status(relation.get("status") or relation.get("run_tray_status"))
        ):
            continue
        experiment_code = _experiment_code(relation)
        if not experiment_code:
            continue
        sub_experiment_code = record_sub_experiment_code(relation)
        if sub_experiment_code:
            completed_by_experiment.setdefault(experiment_code, set()).add(sub_experiment_code)
        else:
            completed_non_axis_experiment_codes.add(experiment_code)

    for experiment_code in axis_aware_experiment_codes:
        required_sub_experiment_codes = {
            _record_sub_code(schedule, experiment_code=experiment_code)
            for schedule in schedules
            if _task_code(schedule) == task_code
            and _experiment_code(schedule) == experiment_code
            and _normalize_axis_codes(schedule.get("axis_codes") or schedule.get("axisCodes"))
            and _record_sub_code(schedule, experiment_code=experiment_code)
        }
        if not required_sub_experiment_codes:
            return False
        if not required_sub_experiment_codes.issubset(completed_by_experiment.get(experiment_code, set())):
            return False

    non_axis_experiment_codes = assigned_experiment_codes - axis_aware_experiment_codes
    return non_axis_experiment_codes.issubset(completed_non_axis_experiment_codes)


def _index_samples(samples: Any) -> dict[str, dict[str, Any]]:
    return {
        code: sample
        for sample in _as_list(samples)
        if isinstance(sample, dict) and (code := _sample_code(sample))
    }


def _index_trays(sample: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(sample, dict):
        return {}
    return {
        code: tray
        for tray in _as_list(sample.get("trays"))
        if isinstance(tray, dict) and (code := _tray_code(tray))
    }


def _validate_samples_lab_arrival_transition(current_samples: Any, next_samples: Any) -> None:
    if not isinstance(next_samples, list):
        return

    current_by_code = _index_samples(current_samples)
    if not current_by_code:
        return

    for next_sample in next_samples:
        if not isinstance(next_sample, dict):
            continue
        current_sample = current_by_code.get(_sample_code(next_sample))
        if not current_sample:
            continue

        current_trays = _index_trays(current_sample)
        next_trays = _as_list(next_sample.get("trays"))
        arrived_tray_count = 0
        for next_tray in next_trays:
            if not isinstance(next_tray, dict) or _status(next_tray) != LAB_ARRIVED_STATUS:
                continue
            arrived_tray_count += 1
            current_tray = current_trays.get(_tray_code(next_tray))
            if _tray_was_lab_arrived(current_sample, current_tray):
                continue
            if _tray_was_completed_experiment(current_sample, current_tray) and _sample_has_lab_arrival_history(next_sample):
                continue
            if not _tray_was_dispatched(current_sample, current_tray):
                raise HTTPException(status_code=400, detail=LAB_ARRIVAL_REQUIRES_DISPATCH_DETAIL)

        next_sample_status = {
            _normalize_text(next_sample.get("status")),
            _normalize_text(next_sample.get("flow_status")),
        }
        if LAB_ARRIVED_STATUS in next_sample_status and arrived_tray_count == 0 and not _sample_was_dispatched(current_sample):
            if _sample_was_lab_arrived(current_sample):
                continue
            raise HTTPException(status_code=400, detail=LAB_ARRIVAL_REQUIRES_DISPATCH_DETAIL)


def _validate_samples_staging_reentry_transition(
    current_samples: Any,
    next_samples: Any,
    experiments: Any,
    experiment_runs: Any,
    experiment_run_steps: Any,
    experiment_trays: Any,
    experiment_run_trays: Any,
    schedules: Any,
    staging_events: Any,
    next_staging_events: Any | None = None,
) -> None:
    if not isinstance(next_samples, list):
        return

    current_by_code = _index_samples(current_samples)
    if not current_by_code:
        return

    for next_sample in next_samples:
        if not isinstance(next_sample, dict):
            continue
        current_sample = current_by_code.get(_sample_code(next_sample))
        if not current_sample:
            continue

        current_trays = _index_trays(current_sample)
        for next_tray in _as_list(next_sample.get("trays")):
            if not isinstance(next_tray, dict):
                continue
            current_tray = current_trays.get(_tray_code(next_tray))
            if _is_post_experiment_staging_inbound(next_sample, next_tray) and _is_appearance_stored(
                current_sample,
                current_tray,
            ):
                proposed_events = next_staging_events if next_staging_events is not None else staging_events
                if not _has_latest_appearance_dispatch_to_staging(proposed_events, _tray_code(next_tray)):
                    raise HTTPException(status_code=400, detail=STAGING_STOCK_IN_BLOCKED_DETAIL)
            if _is_post_experiment_staging_inbound(next_sample, next_tray) and not _post_staging_reentry_is_completed(
                current_sample,
                current_tray,
                experiments,
                experiment_runs,
                experiment_run_steps,
                experiment_trays,
                experiment_run_trays,
                schedules,
            ):
                raise HTTPException(status_code=400, detail=STAGING_STOCK_IN_BLOCKED_DETAIL)
            if _tray_has_blocked_lab_status(current_sample, current_tray) and _tray_is_storage_room_inbound(next_tray):
                if _is_pre_experiment_appearance_inbound(next_sample, next_tray) and _tray_has_allowed_dispatched_pre_experiment_appearance_target(
                    current_sample,
                    next_tray,
                    experiments,
                    current_tray,
                ):
                    if _pre_experiment_appearance_already_dispatched(current_sample, current_tray, staging_events):
                        raise HTTPException(status_code=400, detail=APPEARANCE_REPEAT_STOCK_IN_BLOCKED_DETAIL)
                    continue
                if _is_post_experiment_staging_inbound(next_sample, next_tray) and _post_staging_reentry_is_completed(
                    current_sample,
                    current_tray,
                    experiments,
                    experiment_runs,
                    experiment_run_steps,
                    experiment_trays,
                    experiment_run_trays,
                    schedules,
                ):
                    continue
                if _tray_is_staging_inbound(next_tray) and not _is_post_experiment_staging_inbound(
                    next_sample,
                    next_tray,
                ) and _normal_staging_reentry_is_partial_axis_batch(
                    current_sample,
                    current_tray,
                    experiments,
                    experiment_runs,
                    experiment_run_steps,
                    experiment_trays,
                    experiment_run_trays,
                    schedules,
                ):
                    continue
                raise HTTPException(status_code=400, detail=_stock_in_blocked_detail(next_sample, next_tray))

        if _sample_has_blocked_lab_status(current_sample) and _is_storage_room_inbound(next_sample):
            next_trays = [tray for tray in _as_list(next_sample.get("trays")) if isinstance(tray, dict)]
            if next_trays:
                continue
            raise HTTPException(status_code=400, detail=_stock_in_blocked_detail(next_sample))


def _validate_samples_appearance_source_transition(
    current_samples: Any,
    next_samples: Any,
    experiments: Any,
    experiment_run_trays: Any,
    staging_events: Any,
) -> None:
    if not isinstance(next_samples, list):
        return

    current_by_code = _index_samples(current_samples)
    if not current_by_code:
        return

    for next_sample in next_samples:
        if not isinstance(next_sample, dict):
            continue
        current_sample = current_by_code.get(_sample_code(next_sample))
        if not current_sample:
            continue

        current_trays = _index_trays(current_sample)
        for next_tray in _as_list(next_sample.get("trays")):
            if not isinstance(next_tray, dict) or not _is_appearance_inbound(next_sample, next_tray):
                continue
            current_tray = current_trays.get(_tray_code(next_tray))
            if not _appearance_inbound_state_changed(current_sample, next_sample, current_tray, next_tray):
                continue
            if _is_post_experiment_staging_stored(current_sample, current_tray):
                raise HTTPException(status_code=400, detail=APPEARANCE_STOCK_IN_BLOCKED_DETAIL)
            if _is_pre_experiment_appearance_inbound(next_sample, next_tray) and _tray_has_allowed_pre_experiment_appearance_target(
                current_sample,
                next_tray,
                experiments,
                current_tray,
            ):
                continue
            if _is_pre_experiment_appearance_inbound(next_sample, next_tray) and _tray_has_allowed_dispatched_pre_experiment_appearance_target(
                current_sample,
                next_tray,
                experiments,
                current_tray,
            ):
                if _pre_experiment_appearance_already_dispatched(current_sample, current_tray, staging_events):
                    raise HTTPException(status_code=400, detail=APPEARANCE_REPEAT_STOCK_IN_BLOCKED_DETAIL)
                continue
            if _is_pre_experiment_appearance_inbound(next_sample, next_tray):
                raise HTTPException(status_code=400, detail=APPEARANCE_SOURCE_REQUIRED_DETAIL)
            if not _tray_has_allowed_appearance_source(
                current_sample,
                next_sample,
                current_tray,
                next_tray,
                experiments,
                experiment_run_trays,
            ):
                raise HTTPException(status_code=400, detail=APPEARANCE_SOURCE_REQUIRED_DETAIL)

        if not _is_appearance_inbound(next_sample) or not _appearance_inbound_state_changed(current_sample, next_sample, None, None):
            continue
        next_trays = [tray for tray in _as_list(next_sample.get("trays")) if isinstance(tray, dict)]
        if next_trays:
            continue
        if not _tray_has_allowed_appearance_source(
            current_sample,
            next_sample,
            None,
            None,
            experiments,
            experiment_run_trays,
        ):
            raise HTTPException(status_code=400, detail=APPEARANCE_SOURCE_REQUIRED_DETAIL)


def _validate_samples_returned_rearrival_transition(current_samples: Any, next_samples: Any) -> None:
    if not isinstance(next_samples, list):
        return

    current_by_code = _index_samples(current_samples)
    if not current_by_code:
        return

    for next_sample in next_samples:
        if not isinstance(next_sample, dict):
            continue
        current_sample = current_by_code.get(_sample_code(next_sample))
        if not current_sample:
            continue

        current_trays = _index_trays(current_sample)
        for next_tray in _as_list(next_sample.get("trays")):
            if not isinstance(next_tray, dict):
                continue
            current_tray = current_trays.get(_tray_code(next_tray))
            if _tray_was_returned(current_sample, current_tray) and _is_handover_arrival(next_sample, next_tray):
                raise HTTPException(status_code=400, detail=RETURNED_REARRIVAL_BLOCKED_DETAIL)

        if _sample_was_returned(current_sample) and _is_handover_arrival(next_sample):
            raise HTTPException(status_code=400, detail=RETURNED_REARRIVAL_BLOCKED_DETAIL)


def _validate_samples_maintenance_lock(current_samples: Any, next_samples: Any, devices: Any) -> None:
    if not isinstance(next_samples, list):
        return

    current_by_code = _index_samples(current_samples)
    for next_sample in next_samples:
        if not isinstance(next_sample, dict):
            continue
        current_sample = current_by_code.get(_sample_code(next_sample))
        sample_statuses = {
            _normalize_text(next_sample.get("status")),
            _normalize_text(next_sample.get("flow_status")),
        }
        tray_statuses = {_status(tray) for tray in _as_list(next_sample.get("trays")) if isinstance(tray, dict)}
        if not ((sample_statuses | tray_statuses) & LAB_MAINTENANCE_BLOCKED_STATUSES):
            continue
        current_statuses = {
            _normalize_text(current_sample.get("status")) if isinstance(current_sample, dict) else "",
            _normalize_text(current_sample.get("flow_status")) if isinstance(current_sample, dict) else "",
        }
        current_statuses.update(_status(tray) for tray in _as_list(current_sample.get("trays")) if isinstance(tray, dict))
        current_location = _normalize_text(current_sample.get("location")) if isinstance(current_sample, dict) else ""
        next_location = _normalize_text(next_sample.get("location"))
        if next_location == current_location and (sample_statuses | tray_statuses) <= current_statuses:
            continue
        unavailable_device = _find_unavailable_device(devices, next_location)
        if unavailable_device:
            device_name = _device_name(unavailable_device) or next_location
            raise HTTPException(status_code=400, detail=f"{device_name}设备维护中，禁止实验室操作")


def _validate_fixture_locked_schedules(
    current_schedules: Any,
    next_schedules: Any,
    samples: Any,
    experiment_runs: Any,
    experiment_run_trays: Any,
    experiment_trays: Any,
    experiment_run_steps: Any,
) -> None:
    if not isinstance(next_schedules, list):
        return
    next_by_id = {
        _schedule_id(schedule): schedule
        for schedule in _as_list(next_schedules)
        if isinstance(schedule, dict) and _schedule_id(schedule)
    }
    for current_schedule in _as_list(current_schedules):
        if not isinstance(current_schedule, dict) or not _schedule_is_fixture_locked(
            current_schedule,
            samples,
            experiment_trays,
            experiment_runs,
            experiment_run_trays,
        ):
            continue
        if _is_partially_completed_multi_axis_schedule(current_schedule, experiment_run_steps):
            continue
        schedule_id = _schedule_id(current_schedule)
        next_schedule = next_by_id.get(schedule_id)
        if not schedule_id or next_schedule is None or _locked_schedule_fields_changed(current_schedule, next_schedule):
            raise HTTPException(status_code=400, detail=SCHEDULE_FIXTURE_LOCKED_DETAIL)


def _read_current_storage_value(storage: Any, current_snapshot: Dict[str, Any] | None, key: str) -> Any:
    if current_snapshot is not None and key in current_snapshot:
        return current_snapshot[key]
    return storage.read(key)


def _validate_storage_update(storage: Any, updates: Dict[str, Any], current_snapshot: Dict[str, Any] | None = None) -> None:
    if "mes.schedules" in updates:
        _validate_fixture_locked_schedules(
            _read_current_storage_value(storage, current_snapshot, "mes.schedules"),
            updates["mes.schedules"],
            _read_current_storage_value(storage, current_snapshot, "mes.samples"),
            _read_current_storage_value(storage, current_snapshot, "mes.experiment_runs"),
            _read_current_storage_value(storage, current_snapshot, "mes.experiment_run_trays"),
            _read_current_storage_value(storage, current_snapshot, "mes.experiment_trays"),
            _read_current_storage_value(storage, current_snapshot, "mes.experiment_run_steps"),
        )
    if "mes.samples" not in updates:
        return
    current_samples = _read_current_storage_value(storage, current_snapshot, "mes.samples")
    current_staging_events = _read_current_storage_value(storage, current_snapshot, "mes.staging_events")
    _validate_samples_lab_arrival_transition(current_samples, updates["mes.samples"])
    _validate_samples_staging_reentry_transition(
        current_samples,
        updates["mes.samples"],
        _read_current_storage_value(storage, current_snapshot, "mes.experiments"),
        _read_current_storage_value(storage, current_snapshot, "mes.experiment_runs"),
        _read_current_storage_value(storage, current_snapshot, "mes.experiment_run_steps"),
        _read_current_storage_value(storage, current_snapshot, "mes.experiment_trays"),
        _read_current_storage_value(storage, current_snapshot, "mes.experiment_run_trays"),
        _read_current_storage_value(storage, current_snapshot, "mes.schedules"),
        current_staging_events,
        updates.get("mes.staging_events", current_staging_events),
    )
    _validate_samples_appearance_source_transition(
        current_samples,
        updates["mes.samples"],
        _read_current_storage_value(storage, current_snapshot, "mes.experiments"),
        _read_current_storage_value(storage, current_snapshot, "mes.experiment_run_trays"),
        current_staging_events,
    )
    _validate_samples_appearance_dispatch_transition(
        current_samples,
        updates["mes.samples"],
        _read_current_storage_value(storage, current_snapshot, "mes.experiments"),
    )
    _validate_samples_returned_rearrival_transition(current_samples, updates["mes.samples"])
    _validate_samples_maintenance_lock(
        current_samples,
        updates["mes.samples"],
        _read_current_storage_value(storage, current_snapshot, "mes.devices"),
    )


def publish_storage_update(keys: list[str], *, source: str = "", request_id: str = "") -> None:
    payload = {
        "keys": list(keys),
        "updatedAt": now_business_text(),
    }
    if source:
        payload["source"] = source
    if request_id:
        payload["requestId"] = request_id
    with _STORAGE_UPDATE_SUBSCRIBERS_LOCK:
        subscribers = list(_STORAGE_UPDATE_SUBSCRIBERS)
    for subscriber in subscribers:
        try:
            subscriber.put_nowait(payload)
        except queue.Full:
            try:
                subscriber.get_nowait()
                subscriber.put_nowait(payload)
            except queue.Empty:
                pass


def _format_sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _storage_update_event_stream():
    subscriber: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=20)
    with _STORAGE_UPDATE_SUBSCRIBERS_LOCK:
        _STORAGE_UPDATE_SUBSCRIBERS.add(subscriber)
    try:
        yield ": connected\n\n"
        while True:
            try:
                payload = subscriber.get(timeout=15)
            except queue.Empty:
                yield ": keepalive\n\n"
                continue
            yield _format_sse(payload)
    finally:
        with _STORAGE_UPDATE_SUBSCRIBERS_LOCK:
            _STORAGE_UPDATE_SUBSCRIBERS.discard(subscriber)


@router.get("")
def read_all() -> Dict[str, Any]:
    storage = get_storage_backend()
    return storage.read_all()


@router.get("/events")
def storage_update_events() -> StreamingResponse:
    return StreamingResponse(_storage_update_event_stream(), media_type="text/event-stream")


def _publish_tray_action_update(updates: dict[str, Any], *, source: str = "", request_id: str = "") -> None:
    keys = list(updates.keys())
    if source or request_id:
        publish_storage_update(keys, source=source, request_id=request_id)
        return
    publish_storage_update(keys)


def _run_storage_tray_action(
    update_builder,
    *,
    room: str,
    tray_code: str,
    payload: dict[str, Any],
    source: str = "",
    request_id: str = "",
) -> dict[str, Any]:
    storage = get_storage_backend()
    action_time = now_business_text()
    try:
        with acquire_laboratory_storage_commit_lock():
            snapshot = storage.read_all()
            updates = update_builder(snapshot, room=room, tray_code=tray_code, payload=payload, now=action_time)
            _validate_storage_update(storage, updates, snapshot)
            storage.write_many(updates)
    except StorageTrayActionError as error:
        raise HTTPException(status_code=error.status_code, detail=error.detail) from error
    _publish_tray_action_update(updates, source=source, request_id=request_id)
    updated_samples = updates.get(SAMPLES_KEY, [])
    return {
        "ok": True,
        "trayCode": tray_code,
        "row": summarize_tray_row(updated_samples, tray_code),
        "updatedKeys": list(updates.keys()),
    }


def _run_storage_schedule_patch(
    payload: dict[str, Any],
    *,
    source: str = "",
    request_id: str = "",
) -> dict[str, Any]:
    storage = get_storage_backend()
    try:
        with acquire_laboratory_storage_commit_lock():
            snapshot = storage.read_all()
            updates = build_schedule_patch_updates(snapshot, payload if isinstance(payload, dict) else {})
            _validate_storage_update(storage, updates, snapshot)
            storage.write_many(updates)
    except StorageSchedulePatchError as error:
        raise HTTPException(status_code=error.status_code, detail=error.detail) from error
    _publish_tray_action_update(updates, source=source, request_id=request_id)
    return {
        "ok": True,
        "updatedKeys": list(updates.keys()),
    }


@router.post("/rooms/{room}/trays/{tray_code}/stock-out")
def stock_out_storage_room_tray(
    room: str,
    tray_code: str,
    payload: Dict[str, Any] = Body(default_factory=dict),
    update_source: str = Header(default="", alias="X-MES-Update-Source"),
    update_request_id: str = Header(default="", alias="X-MES-Update-Request-Id"),
) -> dict[str, Any]:
    return _run_storage_tray_action(
        build_stock_out_updates,
        room=room,
        tray_code=tray_code,
        payload=payload if isinstance(payload, dict) else {},
        source=str(update_source or "").strip(),
        request_id=str(update_request_id or "").strip(),
    )


@router.post("/rooms/{room}/trays/{tray_code}/stock-in")
def stock_in_storage_room_tray(
    room: str,
    tray_code: str,
    payload: Dict[str, Any] = Body(default_factory=dict),
    update_source: str = Header(default="", alias="X-MES-Update-Source"),
    update_request_id: str = Header(default="", alias="X-MES-Update-Request-Id"),
) -> dict[str, Any]:
    return _run_storage_tray_action(
        build_stock_in_updates,
        room=room,
        tray_code=tray_code,
        payload=payload if isinstance(payload, dict) else {},
        source=str(update_source or "").strip(),
        request_id=str(update_request_id or "").strip(),
    )


@router.post("/rooms/{room}/trays/{tray_code}/manufacturer-return")
def return_storage_room_tray_to_manufacturer(
    room: str,
    tray_code: str,
    payload: Dict[str, Any] = Body(default_factory=dict),
    update_source: str = Header(default="", alias="X-MES-Update-Source"),
    update_request_id: str = Header(default="", alias="X-MES-Update-Request-Id"),
) -> dict[str, Any]:
    return _run_storage_tray_action(
        build_manufacturer_return_updates,
        room=room,
        tray_code=tray_code,
        payload=payload if isinstance(payload, dict) else {},
        source=str(update_source or "").strip(),
        request_id=str(update_request_id or "").strip(),
    )


@router.post("/schedules/patch")
def patch_storage_schedules(
    payload: Dict[str, Any] = Body(default_factory=dict),
    update_source: str = Header(default="", alias="X-MES-Update-Source"),
    update_request_id: str = Header(default="", alias="X-MES-Update-Request-Id"),
) -> dict[str, Any]:
    return _run_storage_schedule_patch(
        payload if isinstance(payload, dict) else {},
        source=str(update_source or "").strip(),
        request_id=str(update_request_id or "").strip(),
    )


@router.get("/{key}")
def read_key(key: str) -> Any:
    if key not in STORAGE_KEYS:
        raise HTTPException(status_code=404, detail="Unknown storage key")
    storage = get_storage_backend()
    return storage.read(key)


@router.put("/{key}")
def write_key(key: str, payload: Any = Body(...)) -> Dict[str, bool]:
    if key not in STORAGE_KEYS:
        raise HTTPException(status_code=404, detail="Unknown storage key")
    storage = get_storage_backend()
    with acquire_laboratory_storage_commit_lock():
        snapshot = storage.read_all()
        updates = merge_concurrent_storage_updates(snapshot, {key: payload})
        _validate_storage_update(storage, updates, snapshot)
        storage.write(key, updates[key])
    publish_storage_update([key])
    return {"ok": True}


@router.put("")
def write_many(
    payload: Dict[str, Any] = Body(...),
    update_source: str = Header(default="", alias="X-MES-Update-Source"),
    update_request_id: str = Header(default="", alias="X-MES-Update-Request-Id"),
) -> Dict[str, bool]:
    storage = get_storage_backend()
    updates = {key: value for key, value in payload.items() if key in STORAGE_KEYS}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid storage keys provided")
    with acquire_laboratory_storage_commit_lock():
        snapshot = storage.read_all()
        updates = merge_concurrent_storage_updates(snapshot, updates)
        _validate_storage_update(storage, updates, snapshot)
        storage.write_many(updates)
    source = str(update_source or "").strip()
    request_id = str(update_request_id or "").strip()
    if source or request_id:
        publish_storage_update(list(updates.keys()), source=source, request_id=request_id)
    else:
        publish_storage_update(list(updates.keys()))
    return {"ok": True}
