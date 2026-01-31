from typing import Any, Dict

from fastapi import APIRouter, Body, HTTPException

from app.core.storage_backend import STORAGE_KEYS, get_storage_backend

router = APIRouter(prefix="/api/storage", tags=["storage"])


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
    storage.write(key, payload)
    return {"ok": True}


@router.put("")
def write_many(payload: Dict[str, Any] = Body(...)) -> Dict[str, bool]:
    storage = get_storage_backend()
    updates = {key: value for key, value in payload.items() if key in STORAGE_KEYS}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid storage keys provided")
    storage.write_many(updates)
    return {"ok": True}
