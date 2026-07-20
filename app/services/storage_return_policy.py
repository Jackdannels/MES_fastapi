from typing import Any

from fastapi import HTTPException


RETURNED_STATUS = "厂家收回"
HANDOVER_ARRIVAL_STATUSES = {"到货"}
RETURNED_REARRIVAL_BLOCKED_DETAIL = "该托盘已厂家收回，不能再次到货。"


def _text(value: Any) -> str:
    return str(value or "").strip()


def _rows(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _status(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    return _text(value.get("status")) or _text(value.get("flow_status"))


def _sample_was_returned(sample: Any) -> bool:
    if not isinstance(sample, dict):
        return False
    return RETURNED_STATUS in {
        _text(sample.get("status")),
        _text(sample.get("flow_status")),
        _text(sample.get("location")),
    }


def _is_handover_arrival(sample: Any, tray: Any | None = None) -> bool:
    if not isinstance(sample, dict):
        return False
    statuses = {_text(sample.get("status")), _text(sample.get("flow_status"))}
    if isinstance(tray, dict):
        statuses.add(_status(tray))
    return bool(statuses & HANDOVER_ARRIVAL_STATUSES)


def validate_samples_returned_rearrival(current_samples: Any, next_samples: Any) -> None:
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
            if (_status(current_tray) == RETURNED_STATUS or _sample_was_returned(current_sample)) and _is_handover_arrival(next_sample, next_tray):
                raise HTTPException(status_code=400, detail=RETURNED_REARRIVAL_BLOCKED_DETAIL)
        if _sample_was_returned(current_sample) and _is_handover_arrival(next_sample):
            raise HTTPException(status_code=400, detail=RETURNED_REARRIVAL_BLOCKED_DETAIL)
