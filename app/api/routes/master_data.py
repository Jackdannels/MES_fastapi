from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app.core.master_data import DEFAULT_LABS, DEFAULT_TEST_TYPES, is_legacy_seed_lab, is_legacy_seed_test_type, serialize_lab, serialize_test_type
from app.core.storage_backend import get_storage_backend

router = APIRouter(prefix="/api/master", tags=["master-data"])


def _read_rows(method_name: str, defaults: tuple[dict[str, Any], ...]) -> list[dict[str, Any]]:
    try:
        storage = get_storage_backend()
        reader = getattr(storage, method_name, None)
        if callable(reader):
            rows = reader()
            if isinstance(rows, list):
                return [dict(row) for row in rows if isinstance(row, dict)]
    except Exception:
        pass
    return [dict(row) for row in defaults]


@router.get("/test-types")
def list_test_types() -> list[dict[str, Any]]:
    raw_rows = _read_rows("list_test_types", DEFAULT_TEST_TYPES)
    rows = [row for row in raw_rows if not is_legacy_seed_test_type(row)]
    if raw_rows and not rows:
        rows = [dict(row) for row in DEFAULT_TEST_TYPES]
    return [serialize_test_type(row) for row in rows]


@router.get("/labs")
def list_labs() -> list[dict[str, Any]]:
    raw_rows = _read_rows("list_labs", DEFAULT_LABS)
    rows = [row for row in raw_rows if not is_legacy_seed_lab(row)]
    if raw_rows and not rows:
        rows = [dict(row) for row in DEFAULT_LABS]
    return [serialize_lab(row) for row in rows]
