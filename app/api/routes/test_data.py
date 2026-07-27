from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.storage_backend import get_storage_backend
from app.services.test_data_reports import (
    list_export_records,
    read_test_data_settings,
    retry_failed_exports,
    update_test_data_settings,
)


router = APIRouter(prefix="/api/test-data", tags=["test-data"])


class DataSettingsRequest(BaseModel):
    savePath: str


class RetryFailedExportsRequest(BaseModel):
    exportKeys: list[str] = Field(default_factory=list)


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return read_test_data_settings(storage=get_storage_backend())


@router.put("/settings")
def put_settings(payload: DataSettingsRequest) -> dict[str, Any]:
    try:
        return update_test_data_settings(payload.savePath, storage=get_storage_backend())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/exports")
def get_exports(status: str = Query(default="")) -> dict[str, Any]:
    items = list_export_records(storage=get_storage_backend(), status=status)
    return {
        "items": items,
        "total": len(items),
        "failedCount": sum(1 for item in items if str(item.get("status") or "") == "failed"),
    }


@router.post("/retry-failed")
def retry_failed(payload: RetryFailedExportsRequest | None = None) -> dict[str, Any]:
    return retry_failed_exports(
        export_keys=(payload.exportKeys if payload else []),
        storage=get_storage_backend(),
    )
