from typing import Any

from fastapi import HTTPException

from app.services.appearance_inspection import (
    PRE_EXPERIMENT_APPEARANCE_STATUS,
    target_requires_appearance_inspection,
)


LAB_DISPATCHED_STATUS = "送至实验室"
APPEARANCE_LOCATION_KEYWORD = "外观检测间"
APPEARANCE_DISPATCH_TARGET_REQUIRED_DETAIL = "目标实验室与当前托盘不匹配"


def _text(value: Any) -> str:
    return str(value or "").strip()


def _rows(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _status(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    return _text(value.get("status")) or _text(value.get("flow_status"))


def _is_pre_experiment_appearance_inbound(sample: Any, tray: Any) -> bool:
    return (
        isinstance(sample, dict)
        and isinstance(tray, dict)
        and _status(tray) == PRE_EXPERIMENT_APPEARANCE_STATUS
        and APPEARANCE_LOCATION_KEYWORD in _text(sample.get("location"))
    )


def _is_lab_dispatch_outbound(sample: Any, tray: Any) -> bool:
    if not isinstance(sample, dict):
        return False
    statuses = {_text(sample.get("status")), _text(sample.get("flow_status"))}
    if isinstance(tray, dict):
        statuses.add(_status(tray))
    return LAB_DISPATCHED_STATUS in statuses


def _appearance_dispatch_target_is_allowed(next_sample: Any, next_tray: Any, experiments: Any) -> bool:
    if not isinstance(next_sample, dict) or not isinstance(next_tray, dict):
        return True
    target_type = _text(next_tray.get("target_type") or next_tray.get("targetType"))
    if target_type == "staging":
        return True
    target_lab = _text(next_tray.get("target_lab") or next_tray.get("targetLab")) or _text(next_sample.get("location"))
    target_experiment_code = _text(next_tray.get("target_experiment_code") or next_tray.get("targetExperimentCode"))
    return target_requires_appearance_inspection(
        target_lab=target_lab,
        target_experiment_code=target_experiment_code,
        experiments=experiments,
    )


def validate_samples_appearance_dispatch(current_samples: Any, next_samples: Any, experiments: Any) -> None:
    if not isinstance(next_samples, list):
        return
    current_by_code = {
        _text(sample.get("code")): sample
        for sample in _rows(current_samples)
        if isinstance(sample, dict) and _text(sample.get("code"))
    }
    if not current_by_code:
        return
    for next_sample in next_samples:
        if not isinstance(next_sample, dict):
            continue
        current_sample = current_by_code.get(_text(next_sample.get("code")))
        if not current_sample:
            continue
        current_trays = {
            _text(tray.get("tray_code")): tray
            for tray in _rows(current_sample.get("trays"))
            if isinstance(tray, dict) and _text(tray.get("tray_code"))
        }
        for next_tray in _rows(next_sample.get("trays")):
            if not isinstance(next_tray, dict):
                continue
            current_tray = current_trays.get(_text(next_tray.get("tray_code")))
            if not _is_pre_experiment_appearance_inbound(current_sample, current_tray):
                continue
            if not _is_lab_dispatch_outbound(next_sample, next_tray):
                continue
            if not _appearance_dispatch_target_is_allowed(next_sample, next_tray, experiments):
                raise HTTPException(status_code=400, detail=APPEARANCE_DISPATCH_TARGET_REQUIRED_DETAIL)
