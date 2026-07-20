from typing import Any

from fastapi import HTTPException


LAB_DISPATCHED_STATUS = "送至实验室"
LAB_ARRIVED_STATUS = "已到达实验室"
COMPLETED_EXPERIMENT_STATUSES = {"实验已完成", "实验完成", "实验已经完成"}
LAB_ARRIVAL_REQUIRES_DISPATCH_DETAIL = "托盘尚未从接驳间出库，不能直接到达实验室"


def _text(value: Any) -> str:
    return str(value or "").strip()


def _rows(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _status(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    return _text(value.get("status")) or _text(value.get("flow_status"))


def _sample_was_dispatched(sample: Any) -> bool:
    return isinstance(sample, dict) and LAB_DISPATCHED_STATUS in {_text(sample.get("status")), _text(sample.get("flow_status"))}


def _sample_was_lab_arrived(sample: Any) -> bool:
    return isinstance(sample, dict) and LAB_ARRIVED_STATUS in {_text(sample.get("status")), _text(sample.get("flow_status"))}


def _sample_was_completed_experiment(sample: Any) -> bool:
    return isinstance(sample, dict) and bool({_text(sample.get("status")), _text(sample.get("flow_status"))} & COMPLETED_EXPERIMENT_STATUSES)


def _sample_has_lab_arrival_history(sample: Any) -> bool:
    if not isinstance(sample, dict):
        return False
    for entry in _rows(sample.get("history")):
        if not isinstance(entry, dict):
            continue
        if LAB_ARRIVED_STATUS in {_text(entry.get("status")), _text(entry.get("flow_status"))}:
            return True
        if LAB_ARRIVED_STATUS in _text(entry.get("detail")):
            return True
    return False


def validate_samples_lab_arrival(current_samples: Any, next_samples: Any) -> None:
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
        arrived_tray_count = 0
        for next_tray in _rows(next_sample.get("trays")):
            if not isinstance(next_tray, dict) or _status(next_tray) != LAB_ARRIVED_STATUS:
                continue
            arrived_tray_count += 1
            current_tray = current_trays.get(_text(next_tray.get("tray_code")))
            if _status(current_tray) == LAB_ARRIVED_STATUS or _sample_was_lab_arrived(current_sample):
                continue
            if (_status(current_tray) in COMPLETED_EXPERIMENT_STATUSES or _sample_was_completed_experiment(current_sample)) and _sample_has_lab_arrival_history(next_sample):
                continue
            if _status(current_tray) != LAB_DISPATCHED_STATUS and not _sample_was_dispatched(current_sample):
                raise HTTPException(status_code=400, detail=LAB_ARRIVAL_REQUIRES_DISPATCH_DETAIL)

        next_statuses = {_text(next_sample.get("status")), _text(next_sample.get("flow_status"))}
        if LAB_ARRIVED_STATUS in next_statuses and arrived_tray_count == 0 and not _sample_was_dispatched(current_sample):
            if _sample_was_lab_arrived(current_sample):
                continue
            raise HTTPException(status_code=400, detail=LAB_ARRIVAL_REQUIRES_DISPATCH_DETAIL)
