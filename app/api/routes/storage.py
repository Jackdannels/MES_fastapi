from datetime import datetime
from typing import Any, Dict

from fastapi import APIRouter, Body, Header, HTTPException, Query, Response
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, StreamingResponse

from app.core.axis_codes import sort_axis_codes
from app.core.storage_backend import STORAGE_KEYS, get_storage_backend
from app.core.time_utils import now_business_datetime, now_business_text, parse_business_datetime
from app.services.appearance_inspection import (
    PRE_EXPERIMENT_APPEARANCE_STATUS,
    experiment_requires_appearance_inspection,
    pre_experiment_appearance_already_dispatched,
    should_route_pre_experiment_appearance,
    target_requires_appearance_inspection,
)
from app.services.laboratory_operations import acquire_laboratory_storage_commit_lock
from app.services.laboratory_occupancy import (
    LABORATORY_OCCUPANCY_RUNS_KEY,
    LABORATORY_OCCUPANCY_RUN_TRAYS_KEY,
    LABORATORY_OCCUPANCY_SAMPLES_KEY,
)
from app.services.experiment_segments import record_sub_experiment_code, resolve_record_sub_experiment_code
from app.services.experiment_schedule_sequence import (
    ExperimentScheduleSequenceError,
    assert_expected_next_scheduled_step,
)
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
from app.services.storage_schedule_patch import (
    PATCHABLE_KEYS,
    StorageSchedulePatchError,
    build_schedule_patch_updates,
    validate_maintenance_time_order,
    validate_schedule_maintenance_conflicts,
)
from app.services.storage_update_bus import publish_storage_update, storage_update_event_stream as _storage_update_event_stream
from app.services.read_through_cache import read_snapshot_cache, storage_cache_identity
from app.services.device_running_repair import (
    DeviceRunningRepairError,
    build_completed_running_repair_updates,
)
from app.services.storage_read_helpers import (
    _as_list,
    _experiment_code,
    _normalize_axis_codes,
    _normalize_text,
    _normalize_tray_scan_code,
    _parse_datetime,
    _record_axis_batch_no,
    _record_axis_codes,
    _record_schedule_id,
    _record_sub_code,
    _run_no,
    _sample_code,
    _schedule_id,
    _status,
    _task_code,
    _tray_code,
)

from app.services.storage_policies import (
    SCHEDULE_COMPARE_LOCKED_DETAIL,
    SCHEDULE_LOCKED_AFTER_COMPARE_STATUSES,
    STAGING_STOCK_IN_BLOCKED_CURRENT_STATUSES,
)
from app.services.storage_maintenance_policy import (
    device_is_unavailable as _device_is_unavailable,
    validate_device_schedule_maintenance_conflicts,
    validate_samples_maintenance_lock,
)
from app.services.storage_return_policy import HANDOVER_ARRIVAL_STATUSES, validate_samples_returned_rearrival
from app.services.storage_lab_arrival_policy import validate_samples_lab_arrival
from app.services.storage_appearance_policy import validate_samples_appearance_dispatch
from app.services.storage_staging_policy import (
    _normal_staging_reentry_is_partial_axis_batch,
    _post_staging_reentry_is_completed,
    tray_has_scoped_partial_axis_batch_completion,
)
from app.services.storage_schedule_lock_policy import (
    validate_fixture_locked_schedules as _validate_fixture_locked_schedules,
)

router = APIRouter(prefix="/api/storage", tags=["storage"])

LAB_DISPATCHED_STATUS = "送至实验室"
LAB_ARRIVED_STATUS = "已到达实验室"
LAB_ARRIVAL_REQUIRES_DISPATCH_DETAIL = "托盘尚未从接驳间出库，不能直接到达实验室"
STAGING_STOCK_IN_BLOCKED_DETAIL = "该托盘已进入试验间流程，不能暂存间入库。"
APPEARANCE_STOCK_IN_BLOCKED_DETAIL = "该托盘已进入试验间流程，不能外观检测间入库。"
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
COMPLETED_EXPERIMENT_STATUSES = {"实验已完成", "实验完成", "实验已经完成"}
LAB_SEQUENCE_CONTROLLED_STATUSES = {
    LAB_DISPATCHED_STATUS,
    LAB_ARRIVED_STATUS,
    "工装夹具安装",
    "实验准备就绪",
    "实验进行中",
    "实验中",
}
TRAY_ACTION_SCOPE_KEYS = (
    "mes.tasks",
    "mes.samples",
    "mes.schedules",
    "mes.experiments",
    "mes.experiment_runs",
    "mes.experiment_run_pauses",
    "mes.experiment_run_trays",
    "mes.experiment_run_steps",
    "mes.experiment_trays",
    "mes.staging_events",
    "mes.devices",
)
LAB_OCCUPANCY_READ_KEYS = (
    "mes.samples",
    "mes.experiment_runs",
    "mes.experiment_run_trays",
)
LAB_OCCUPANCY_SNAPSHOT_KEYS = {
    "mes.samples": LABORATORY_OCCUPANCY_SAMPLES_KEY,
    "mes.experiment_runs": LABORATORY_OCCUPANCY_RUNS_KEY,
    "mes.experiment_run_trays": LABORATORY_OCCUPANCY_RUN_TRAYS_KEY,
}
SAMPLE_UPDATE_DEPENDENCY_KEYS = {
    "mes.tasks",
    "mes.samples",
    "mes.staging_events",
    "mes.experiments",
    "mes.experiment_runs",
    "mes.experiment_run_pauses",
    "mes.experiment_run_steps",
    "mes.experiment_trays",
    "mes.experiment_run_trays",
    "mes.schedules",
    "mes.devices",
}
SCHEDULE_UPDATE_DEPENDENCY_KEYS = {
    "mes.schedules",
    "mes.samples",
    "mes.experiment_runs",
    "mes.experiment_run_trays",
    "mes.experiment_trays",
    "mes.experiment_run_steps",
    "mes.devices",
}
























def _is_completed_status(value: Any) -> bool:
    return _normalize_text(value) in COMPLETED_EXPERIMENT_STATUSES




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


def _normalize_future_maintenance_device_statuses(updates: dict[str, Any]) -> dict[str, Any]:
    devices = updates.get("mes.devices")
    if not isinstance(devices, list):
        return updates
    now = now_business_datetime()
    normalized_devices = []
    for device in devices:
        if not isinstance(device, dict):
            normalized_devices.append(device)
            continue
        next_device = dict(device)
        start_at = _parse_datetime(device.get("maintenance_start_at") or device.get("maintenanceStartAt"))
        maintenance_type = _normalize_text(device.get("maintenance_type") or device.get("maintenanceType"))
        status = _normalize_text(device.get("status"))
        if start_at and start_at > now and maintenance_type.startswith("计划") and any(keyword in status for keyword in ["维修", "保养"]):
            next_device["status"] = "可用"
        normalized_devices.append(next_device)
    return {**updates, "mes.devices": normalized_devices}


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


def _tray_sequence_signature(sample: Any, tray: Any) -> tuple[str, ...]:
    sample_value = sample if isinstance(sample, dict) else {}
    tray_value = tray if isinstance(tray, dict) else {}
    return (
        _status(tray_value) or _status(sample_value),
        _normalize_text(tray_value.get("target_schedule_id") or tray_value.get("targetScheduleId")),
        _normalize_text(tray_value.get("target_experiment_code") or tray_value.get("targetExperimentCode")),
        _normalize_text(tray_value.get("target_sub_experiment_code") or tray_value.get("targetSubExperimentCode")),
        _normalize_text(tray_value.get("target_axis_batch_no") or tray_value.get("targetAxisBatchNo")),
        _normalize_text(tray_value.get("target_lab_id") or tray_value.get("targetLabId")),
        _normalize_text(tray_value.get("target_lab_code") or tray_value.get("targetLabCode")),
        _normalize_text(tray_value.get("target_lab") or tray_value.get("targetLab")),
        str(bool(tray_value.get("fixture_ready") or tray_value.get("fixtureReady"))),
    )


def _validate_samples_experiment_sequence(
    current_snapshot: dict[str, Any],
    current_samples: Any,
    next_samples: Any,
) -> None:
    if not isinstance(next_samples, list):
        return
    current_by_code = _index_samples(current_samples)
    for next_sample in next_samples:
        if not isinstance(next_sample, dict):
            continue
        current_sample = current_by_code.get(_sample_code(next_sample), {})
        current_trays = _index_trays(current_sample)
        sample_status_changed = _status(next_sample) != _status(current_sample)
        for next_tray in _as_list(next_sample.get("trays")):
            if not isinstance(next_tray, dict):
                continue
            tray_code = _tray_code(next_tray)
            current_tray = current_trays.get(tray_code, {})
            next_signature = _tray_sequence_signature(next_sample, next_tray)
            if next_signature[0] not in LAB_SEQUENCE_CONTROLLED_STATUSES:
                continue
            tray_has_own_status = bool(_status(next_tray) or _status(current_tray))
            if next_signature == _tray_sequence_signature(current_sample, current_tray) and (
                tray_has_own_status or not sample_status_changed
            ):
                continue
            task_code = _task_code(next_sample) or _task_code(current_sample)
            schedule_id = next_signature[1]
            if not task_code or not tray_code or not schedule_id:
                raise HTTPException(status_code=409, detail="实验流程变更缺少当前排程标识，请刷新后重试")
            try:
                assert_expected_next_scheduled_step(
                    current_snapshot,
                    task_code=task_code,
                    tray_code=tray_code,
                    schedule_id=schedule_id,
                    experiment_code=next_signature[2],
                    sub_experiment_code=next_signature[3],
                    axis_batch_no=next_signature[4],
                    lab_id=next_signature[5],
                    lab_code=next_signature[6],
                    lab_name=next_signature[7],
                )
            except ExperimentScheduleSequenceError as exc:
                raise HTTPException(status_code=409, detail=str(exc)) from exc


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


def _read_current_storage_value(storage: Any, current_snapshot: Dict[str, Any] | None, key: str) -> Any:
    if current_snapshot is not None and key in current_snapshot:
        return current_snapshot[key]
    return storage.read(key)


def _validate_storage_update(
    storage: Any,
    updates: Dict[str, Any],
    current_snapshot: Dict[str, Any] | None = None,
    *,
    allow_terminal_schedule_cleanup: bool = False,
) -> None:
    if "mes.schedules" in updates:
        _validate_fixture_locked_schedules(
            _read_current_storage_value(storage, current_snapshot, "mes.schedules"),
            updates["mes.schedules"],
            _read_current_storage_value(storage, current_snapshot, "mes.samples"),
            _read_current_storage_value(storage, current_snapshot, "mes.experiment_runs"),
            _read_current_storage_value(storage, current_snapshot, "mes.experiment_run_trays"),
            _read_current_storage_value(storage, current_snapshot, "mes.experiment_trays"),
            _read_current_storage_value(storage, current_snapshot, "mes.experiment_run_steps"),
            allow_terminal_schedule_cleanup=allow_terminal_schedule_cleanup,
        )
    validate_device_schedule_maintenance_conflicts(storage, updates, current_snapshot)
    if "mes.samples" not in updates:
        return
    current_samples = _read_current_storage_value(storage, current_snapshot, "mes.samples")
    current_staging_events = _read_current_storage_value(storage, current_snapshot, "mes.staging_events")
    validate_samples_lab_arrival(current_samples, updates["mes.samples"])
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
    validate_samples_appearance_dispatch(
        current_samples,
        updates["mes.samples"],
        _read_current_storage_value(storage, current_snapshot, "mes.experiments"),
    )
    validate_samples_returned_rearrival(current_samples, updates["mes.samples"])
    validate_samples_maintenance_lock(
        current_samples,
        updates["mes.samples"],
        _read_current_storage_value(storage, current_snapshot, "mes.devices"),
    )
    _validate_samples_experiment_sequence(current_snapshot or {}, current_samples, updates["mes.samples"])


@router.get("")
def read_all(keys: str = Query(default=""), profile: str = Query(default="")) -> Response:
    storage = get_storage_backend()
    normalized_profile = profile.strip().lower()
    if normalized_profile not in {"", "dashboard", "visualization"}:
        raise HTTPException(status_code=400, detail="Unsupported storage read profile")
    requested_keys = list(dict.fromkeys(
        key.strip() for key in keys.split(",") if key.strip() in STORAGE_KEYS
    ))
    if requested_keys:
        def load_requested() -> bytes:
            operational_reader = getattr(storage, "read_operational_snapshot", None)
            if normalized_profile and callable(operational_reader):
                payload = operational_reader(requested_keys)
            elif hasattr(storage, "read_many"):
                payload = storage.read_many(requested_keys)
            else:
                payload = {key: storage.read(key) for key in requested_keys}
            return JSONResponse(content=jsonable_encoder(payload)).body

        body, cache_status = read_snapshot_cache.get_or_load(
            ("storage", storage_cache_identity(storage), normalized_profile, tuple(requested_keys)),
            load_requested,
        )
        return Response(content=body, media_type="application/json", headers={"X-MES-Read-Cache": cache_status})
    if keys.strip():
        return Response(content=b"{}", media_type="application/json")

    def load_all() -> bytes:
        return JSONResponse(content=jsonable_encoder(storage.read_all())).body

    body, cache_status = read_snapshot_cache.get_or_load(
        ("storage", storage_cache_identity(storage), "all"),
        load_all,
    )
    return Response(content=body, media_type="application/json", headers={"X-MES-Read-Cache": cache_status})


@router.get("/events")
def storage_update_events() -> StreamingResponse:
    return StreamingResponse(_storage_update_event_stream(), media_type="text/event-stream")


def _publish_tray_action_update(updates: dict[str, Any], *, source: str = "", request_id: str = "") -> None:
    keys = list(updates.keys())
    if source or request_id:
        publish_storage_update(keys, source=source, request_id=request_id)
        return
    publish_storage_update(keys)


def _read_tray_action_snapshot(
    storage: Any,
    tray_code: str,
    *,
    include_global_lab_occupancy: bool = False,
) -> tuple[dict[str, Any], str, bool]:
    task_resolver = getattr(storage, "find_task_code_by_tray", None)
    scope_reader = getattr(storage, "read_task_scope", None)
    scope_writer = getattr(storage, "write_task_scope", None)
    if callable(task_resolver) and callable(scope_reader) and callable(scope_writer):
        task_code = _normalize_text(task_resolver(tray_code))
        if task_code:
            snapshot = scope_reader({task_code}, TRAY_ACTION_SCOPE_KEYS)
            if include_global_lab_occupancy:
                read_many = getattr(storage, "read_many", None)
                occupancy_snapshot = (
                    read_many(LAB_OCCUPANCY_READ_KEYS)
                    if callable(read_many)
                    else storage.read_all()
                )
                for storage_key, snapshot_key in LAB_OCCUPANCY_SNAPSHOT_KEYS.items():
                    snapshot[snapshot_key] = occupancy_snapshot.get(storage_key, [])
            return snapshot, task_code, True
    return storage.read_all(), "", False


def _stock_out_targets_laboratory(update_builder: Any, payload: dict[str, Any]) -> bool:
    if update_builder is not build_stock_out_updates:
        return False
    target_type = _normalize_text(payload.get("targetType") or payload.get("target_type")) or "lab"
    return target_type == "lab"


def _read_storage_update_snapshot(storage: Any, update_keys: Any) -> dict[str, Any]:
    requested = {key for key in update_keys if key in STORAGE_KEYS}
    if "mes.samples" in requested:
        requested.update(SAMPLE_UPDATE_DEPENDENCY_KEYS)
    if "mes.schedules" in requested:
        requested.update(SCHEDULE_UPDATE_DEPENDENCY_KEYS)
    if "mes.devices" in requested:
        requested.update({"mes.devices", "mes.schedules"})
    read_many = getattr(storage, "read_many", None)
    if callable(read_many):
        return read_many(sorted(requested))
    return storage.read_all()


def _run_storage_tray_action(
    update_builder,
    *,
    room: str,
    tray_code: str,
    payload: dict[str, Any],
    source: str = "",
    request_id: str = "",
    allow_terminal_schedule_cleanup: bool = False,
) -> dict[str, Any]:
    storage = get_storage_backend()
    action_time = now_business_text()
    normalized_tray_code = _normalize_tray_scan_code(tray_code)
    try:
        with acquire_laboratory_storage_commit_lock():
            snapshot, task_code, scoped = _read_tray_action_snapshot(
                storage,
                normalized_tray_code,
                include_global_lab_occupancy=_stock_out_targets_laboratory(update_builder, payload),
            )
            updates = update_builder(snapshot, room=room, tray_code=normalized_tray_code, payload=payload, now=action_time)
            _validate_storage_update(
                storage,
                updates,
                snapshot,
                allow_terminal_schedule_cleanup=allow_terminal_schedule_cleanup,
            )
            if scoped:
                storage.write_task_scope(updates, task_codes={task_code})
            else:
                storage.write_many(updates)
    except StorageTrayActionError as error:
        raise HTTPException(status_code=error.status_code, detail=error.detail) from error
    _publish_tray_action_update(updates, source=source, request_id=request_id)
    updated_samples = updates.get(SAMPLES_KEY, [])
    return {
        "ok": True,
        "trayCode": normalized_tray_code,
        "row": summarize_tray_row(updated_samples, normalized_tray_code),
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
            snapshot = _read_storage_update_snapshot(storage, {*PATCHABLE_KEYS, "mes.devices"})
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
        allow_terminal_schedule_cleanup=True,
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


@router.post("/devices/{device_code}/running-repair")
def complete_running_experiment_for_device_repair(
    device_code: str,
    payload: Dict[str, Any] = Body(default_factory=dict),
    update_source: str = Header(default="", alias="X-MES-Update-Source"),
    update_request_id: str = Header(default="", alias="X-MES-Update-Request-Id"),
) -> dict[str, Any]:
    storage = get_storage_backend()
    completed_at = now_business_text()
    try:
        with acquire_laboratory_storage_commit_lock():
            snapshot = storage.read_all()
            updates = build_completed_running_repair_updates(
                snapshot,
                device_code=device_code,
                payload=payload if isinstance(payload, dict) else {},
                completed_at=completed_at,
            )
            _validate_storage_update(storage, updates, snapshot)
            storage.write_many(updates)
    except DeviceRunningRepairError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error

    source = str(update_source or "").strip()
    request_id = str(update_request_id or "").strip()
    _publish_tray_action_update(updates, source=source, request_id=request_id)
    return {
        "ok": True,
        "completedAt": completed_at,
        "updatedKeys": list(updates.keys()),
    }


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
        snapshot = _read_storage_update_snapshot(storage, {key})
        updates = merge_concurrent_storage_updates(snapshot, {key: payload})
        updates = _normalize_future_maintenance_device_statuses(updates)
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
        snapshot = _read_storage_update_snapshot(storage, updates)
        updates = merge_concurrent_storage_updates(snapshot, updates)
        updates = _normalize_future_maintenance_device_statuses(updates)
        _validate_storage_update(storage, updates, snapshot)
        storage.write_many(updates)
    source = str(update_source or "").strip()
    request_id = str(update_request_id or "").strip()
    if source or request_id:
        publish_storage_update(list(updates.keys()), source=source, request_id=request_id)
    else:
        publish_storage_update(list(updates.keys()))
    return {"ok": True}
