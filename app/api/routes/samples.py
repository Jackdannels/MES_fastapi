from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.core.storage_backend import get_storage_backend
from app.services.sample_page_queries import get_sample_page_query_repository


router = APIRouter(prefix="/api/samples", tags=["samples"])
STAGING_LOCATIONS = ("恒温恒湿间（暂存间）", "恒温恒湿间（实验后暂存间）")


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _sample_identifier(sample: dict[str, Any]) -> tuple[str, str]:
    return _normalize(sample.get("id")), _normalize(sample.get("code"))


def _fallback_page(
    storage: Any,
    *,
    page: int,
    page_size: int,
    query: str,
    task_code: str,
    status: str,
    sort_key: str,
    sort_direction: str,
    view: str,
) -> dict[str, Any]:
    samples = [dict(item) for item in storage.read("mes.samples") if isinstance(item, dict)]
    tasks = [dict(item) for item in storage.read("mes.tasks") if isinstance(item, dict)]
    returned_task_codes = {
        _normalize(task.get("code") or task.get("task_code"))
        for task in tasks
        if _normalize(task.get("transfer_status") or task.get("status")) == "厂家收回"
    }
    normalized_query = _normalize(query).lower()
    normalized_task_code = _normalize(task_code)
    normalized_status = _normalize(status)
    filtered = []
    for sample in samples:
        if _normalize(sample.get("task_code")) in returned_task_codes:
            continue
        if view == "staging" and _normalize(sample.get("location")) not in STAGING_LOCATIONS:
            continue
        tray_codes = [
            _normalize(tray.get("tray_code"))
            for tray in (sample.get("trays") if isinstance(sample.get("trays"), list) else [])
            if isinstance(tray, dict) and _normalize(tray.get("tray_code"))
        ]
        if normalized_task_code and _normalize(sample.get("task_code")) != normalized_task_code:
            continue
        if normalized_status and _normalize(sample.get("status")) != normalized_status:
            continue
        if normalized_query and normalized_query not in " ".join(
            _normalize(value).lower()
            for value in (
                sample.get("code"),
                sample.get("task_code"),
                sample.get("location"),
                sample.get("owner"),
                sample.get("status"),
                sample.get("flow_status"),
                " ".join(tray_codes),
            )
        ):
            continue
        filtered.append({
            "id": _normalize(sample.get("code")) or _normalize(sample.get("id")),
            "code": _normalize(sample.get("code")),
            "task_code": _normalize(sample.get("task_code")),
            "location": _normalize(sample.get("location")),
            "owner": _normalize(sample.get("owner")),
            "status": _normalize(sample.get("status")),
            "flow_status": _normalize(sample.get("flow_status")),
            "trayCodes": tray_codes,
        })
    sort_fields = {
        "code": "code",
        "task_code": "task_code",
        "trayCodesText": "trayCodesText",
        "location": "location",
        "status": "status",
    }
    for item in filtered:
        item["trayCodesText"] = "、".join(item["trayCodes"])
    sort_field = sort_fields.get(_normalize(sort_key), "code")
    filtered.sort(key=lambda item: _normalize(item.get(sort_field)), reverse=_normalize(sort_direction).lower() == "desc")
    total_count = len(filtered)
    total_pages = max(1, (total_count + page_size - 1) // page_size)
    current_page = min(max(page, 1), total_pages)
    start = (current_page - 1) * page_size
    facet_samples = [
        sample
        for sample in samples
        if _normalize(sample.get("task_code")) not in returned_task_codes
        and (view != "staging" or _normalize(sample.get("location")) in STAGING_LOCATIONS)
    ]
    task_options = sorted({_normalize(sample.get("task_code")) for sample in facet_samples if _normalize(sample.get("task_code"))})
    status_options = sorted({_normalize(sample.get("status")) for sample in facet_samples if _normalize(sample.get("status"))})
    return {
        "currentPage": current_page,
        "samples": filtered[start:start + page_size],
        "statusOptions": status_options,
        "taskOptions": task_options,
        "totalCount": total_count,
        "totalPages": total_pages,
    }


@router.get("/page")
def list_sample_page(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=8, alias="pageSize", ge=1, le=100),
    query: str = Query(default=""),
    task_code: str = Query(default="", alias="taskCode"),
    sample_status: str = Query(default="", alias="status"),
    sort_key: str = Query(default="code", alias="sortKey"),
    sort_direction: str = Query(default="asc", alias="sortDirection"),
    view: str = Query(default="flow", pattern="^(flow|staging)$"),
) -> dict[str, Any]:
    storage = get_storage_backend()
    if callable(getattr(storage, "read_task_scope", None)):
        result = get_sample_page_query_repository().list_samples(
            page=page,
            page_size=page_size,
            query=query,
            task_code=task_code,
            status=sample_status,
            sort_key=sort_key,
            sort_direction=sort_direction,
            locations=STAGING_LOCATIONS if view == "staging" else (),
        )
        return {
            "currentPage": result.current_page,
            "samples": list(result.samples),
            "statusOptions": list(result.status_options),
            "taskOptions": list(result.task_options),
            "totalCount": result.total_count,
            "totalPages": result.total_pages,
        }
    return _fallback_page(
        storage,
        page=page,
        page_size=page_size,
        query=query,
        task_code=task_code,
        status=sample_status,
        sort_key=sort_key,
        sort_direction=sort_direction,
        view=view,
    )


@router.get("/{sample_identifier}")
def read_sample_detail(sample_identifier: str) -> dict[str, Any]:
    storage = get_storage_backend()
    scoped_reader = getattr(storage, "read_task_scope", None)
    if callable(scoped_reader):
        task_code = get_sample_page_query_repository().find_task_code(sample_identifier)
        if not task_code:
            raise HTTPException(status_code=404, detail="未找到样品")
        samples = scoped_reader({task_code}, ["mes.samples"]).get("mes.samples", [])
    else:
        samples = storage.read("mes.samples")
    normalized_identifier = _normalize(sample_identifier)
    sample = next(
        (
            dict(item)
            for item in samples
            if isinstance(item, dict) and normalized_identifier in _sample_identifier(item)
        ),
        None,
    )
    if sample is None:
        raise HTTPException(status_code=404, detail="未找到样品")
    return sample


__all__ = ["router"]
