import json
import queue
import threading
from datetime import datetime
from typing import Any, Dict

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import StreamingResponse

from app.core.storage_backend import STORAGE_KEYS, get_storage_backend
from app.core.time_utils import now_business_datetime, now_business_text, parse_business_datetime
from app.services.appearance_inspection import (
    PRE_EXPERIMENT_APPEARANCE_STATUS,
    pre_experiment_appearance_already_dispatched,
    should_route_pre_experiment_appearance,
    target_requires_appearance_inspection,
)
from app.services.laboratory_completion import tray_assigned_experiments_are_completed
from app.services.laboratory_operations import acquire_laboratory_storage_commit_lock
from app.services.storage_atomic import merge_concurrent_storage_updates

router = APIRouter(prefix="/api/storage", tags=["storage"])

LAB_DISPATCHED_STATUS = "送至实验室"
LAB_ARRIVED_STATUS = "已到达实验室"
LAB_ARRIVAL_REQUIRES_DISPATCH_DETAIL = "托盘尚未从接驳间出库，不能直接到达实验室"
STAGING_STOCK_IN_BLOCKED_DETAIL = "该托盘已进入试验间流程，不能暂存间入库。"
APPEARANCE_STOCK_IN_BLOCKED_DETAIL = "该托盘已进入试验间流程，不能外观检测间入库。"
RETURNED_REARRIVAL_BLOCKED_DETAIL = "该托盘已厂家收回，不能再次到货。"
STAGING_LOCATION_KEYWORD = "暂存间"
POST_EXPERIMENT_STAGING_SENT_STATUS = "送至实验后暂存间"
POST_EXPERIMENT_STAGING_STOCKED_STATUS = "实验后暂存间存放"
STAGING_INBOUND_STATUSES = {
    "已到达暂存间",
    POST_EXPERIMENT_STAGING_STOCKED_STATUS,
}
APPEARANCE_LOCATION_KEYWORD = "外观检测间"
APPEARANCE_INBOUND_STATUSES = {"送至外观检测间", "外观检测间存放", "已到达外观检测间", PRE_EXPERIMENT_APPEARANCE_STATUS}
APPEARANCE_SOURCE_REQUIRED_DETAIL = "只有盐雾、霉菌实验完成后才能进入外观检测间。"
APPEARANCE_REPEAT_STOCK_IN_BLOCKED_DETAIL = "该托盘已完成实验前外观检测并出库，不能重复入库外观检测间。"
APPEARANCE_REQUIRED_KEYWORDS = ("盐雾", "霉菌")
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


def _status(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    return _normalize_text(value.get("status")) or _normalize_text(value.get("flow_status"))


def _appearance_experiment_name_is_allowed(value: Any) -> bool:
    text = _normalize_text(value)
    return any(keyword in text for keyword in APPEARANCE_REQUIRED_KEYWORDS)


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
        if _appearance_experiment_name_is_allowed(experiment_name):
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
    return bool(statuses & APPEARANCE_INBOUND_STATUSES) or APPEARANCE_LOCATION_KEYWORD in _normalize_text(sample.get("location"))


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
        or POST_EXPERIMENT_STAGING_SENT_STATUS in statuses
        or "实验后暂存间" in location
    )


def _post_staging_reentry_is_completed(
    sample: Any,
    tray: Any,
    experiment_trays: Any,
    experiment_run_trays: Any,
) -> bool:
    if not isinstance(sample, dict) or not isinstance(tray, dict):
        return False
    return tray_assigned_experiments_are_completed(
        task_code=_normalize_text(sample.get("task_code") or sample.get("task_no")),
        tray_code=_tray_code(tray),
        experiment_trays=[item for item in _as_list(experiment_trays) if isinstance(item, dict)],
        experiment_run_trays=[item for item in _as_list(experiment_run_trays) if isinstance(item, dict)],
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
    experiment_trays: Any,
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
            if not isinstance(next_tray, dict):
                continue
            current_tray = current_trays.get(_tray_code(next_tray))
            if _is_post_experiment_staging_inbound(next_sample, next_tray) and not _post_staging_reentry_is_completed(
                current_sample,
                current_tray,
                experiment_trays,
                experiment_run_trays,
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
                    experiment_trays,
                    experiment_run_trays,
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


def _validate_storage_update(storage: Any, updates: Dict[str, Any]) -> None:
    if "mes.samples" not in updates:
        return
    current_samples = storage.read("mes.samples")
    _validate_samples_lab_arrival_transition(current_samples, updates["mes.samples"])
    _validate_samples_staging_reentry_transition(
        current_samples,
        updates["mes.samples"],
        storage.read("mes.experiments"),
        storage.read("mes.experiment_trays"),
        storage.read("mes.experiment_run_trays"),
        storage.read("mes.staging_events"),
    )
    _validate_samples_appearance_source_transition(
        current_samples,
        updates["mes.samples"],
        storage.read("mes.experiments"),
        storage.read("mes.experiment_run_trays"),
        storage.read("mes.staging_events"),
    )
    _validate_samples_returned_rearrival_transition(current_samples, updates["mes.samples"])
    _validate_samples_maintenance_lock(current_samples, updates["mes.samples"], storage.read("mes.devices"))


def publish_storage_update(keys: list[str]) -> None:
    payload = {
        "keys": list(keys),
        "updatedAt": now_business_text(),
    }
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
        updates = merge_concurrent_storage_updates(storage.read_all(), {key: payload})
        _validate_storage_update(storage, updates)
        storage.write(key, updates[key])
    publish_storage_update([key])
    return {"ok": True}


@router.put("")
def write_many(payload: Dict[str, Any] = Body(...)) -> Dict[str, bool]:
    storage = get_storage_backend()
    updates = {key: value for key, value in payload.items() if key in STORAGE_KEYS}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid storage keys provided")
    with acquire_laboratory_storage_commit_lock():
        updates = merge_concurrent_storage_updates(storage.read_all(), updates)
        _validate_storage_update(storage, updates)
        storage.write_many(updates)
    publish_storage_update(list(updates.keys()))
    return {"ok": True}
