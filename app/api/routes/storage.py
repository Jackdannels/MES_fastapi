from typing import Any, Dict

from fastapi import APIRouter, Body, HTTPException

from app.core.storage_backend import STORAGE_KEYS, get_storage_backend

router = APIRouter(prefix="/api/storage", tags=["storage"])

LAB_DISPATCHED_STATUS = "送至实验室"
LAB_ARRIVED_STATUS = "已到达实验室"
LAB_ARRIVAL_REQUIRES_DISPATCH_DETAIL = "托盘尚未从接驳间出库，不能直接到达实验室"
STAGING_STOCK_IN_BLOCKED_DETAIL = "该托盘已进入试验间流程，不能暂存间入库。"
STAGING_LOCATION_KEYWORD = "暂存间"
STAGING_INBOUND_STATUSES = {"已到达暂存间", "放置实验后暂存间"}
STAGING_STOCK_IN_BLOCKED_CURRENT_STATUSES = {
    LAB_DISPATCHED_STATUS,
    LAB_ARRIVED_STATUS,
    "工装夹具安装",
    "实验准备就绪",
    "实验进行中",
    "实验中",
}


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _sample_code(sample: Any) -> str:
    return _normalize_text(sample.get("code")) if isinstance(sample, dict) else ""


def _tray_code(tray: Any) -> str:
    return _normalize_text(tray.get("tray_code")) if isinstance(tray, dict) else ""


def _status(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    return _normalize_text(value.get("status")) or _normalize_text(value.get("flow_status"))


def _sample_was_dispatched(sample: Any) -> bool:
    if not isinstance(sample, dict):
        return False
    return LAB_DISPATCHED_STATUS in {
        _normalize_text(sample.get("status")),
        _normalize_text(sample.get("flow_status")),
    }


def _tray_was_dispatched(sample: Any, tray: Any) -> bool:
    return _status(tray) == LAB_DISPATCHED_STATUS or _sample_was_dispatched(sample)


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
    return _status(tray) in STAGING_STOCK_IN_BLOCKED_CURRENT_STATUSES or _sample_has_blocked_lab_status(sample)


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
            if not _tray_was_dispatched(current_sample, current_tray):
                raise HTTPException(status_code=400, detail=LAB_ARRIVAL_REQUIRES_DISPATCH_DETAIL)

        next_sample_status = {
            _normalize_text(next_sample.get("status")),
            _normalize_text(next_sample.get("flow_status")),
        }
        if LAB_ARRIVED_STATUS in next_sample_status and arrived_tray_count == 0 and not _sample_was_dispatched(current_sample):
            raise HTTPException(status_code=400, detail=LAB_ARRIVAL_REQUIRES_DISPATCH_DETAIL)


def _validate_samples_staging_reentry_transition(current_samples: Any, next_samples: Any) -> None:
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
            if _tray_has_blocked_lab_status(current_sample, current_tray) and _is_staging_inbound(next_sample, next_tray):
                raise HTTPException(status_code=400, detail=STAGING_STOCK_IN_BLOCKED_DETAIL)

        if _sample_has_blocked_lab_status(current_sample) and _is_staging_inbound(next_sample):
            raise HTTPException(status_code=400, detail=STAGING_STOCK_IN_BLOCKED_DETAIL)


def _validate_storage_update(storage: Any, updates: Dict[str, Any]) -> None:
    if "mes.samples" not in updates:
        return
    current_samples = storage.read("mes.samples")
    _validate_samples_lab_arrival_transition(current_samples, updates["mes.samples"])
    _validate_samples_staging_reentry_transition(current_samples, updates["mes.samples"])


@router.get("")
def read_all() -> Dict[str, Any]:
    storage = get_storage_backend()
    return storage.read_all()


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
    _validate_storage_update(storage, {key: payload})
    storage.write(key, payload)
    return {"ok": True}


@router.put("")
def write_many(payload: Dict[str, Any] = Body(...)) -> Dict[str, bool]:
    storage = get_storage_backend()
    updates = {key: value for key, value in payload.items() if key in STORAGE_KEYS}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid storage keys provided")
    _validate_storage_update(storage, updates)
    storage.write_many(updates)
    return {"ok": True}
