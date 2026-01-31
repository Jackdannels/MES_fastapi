from fastapi import APIRouter, HTTPException, status

from app.core.store import InMemoryStore
from app.schemas.common import EntityCreate, EntityOut, EntityUpdate

router = APIRouter(prefix="/yt_log", tags=["yt_log"])
store = InMemoryStore()


@router.get("", response_model=list[EntityOut])
def list_yt_log():
    return store.list()


@router.get("/{item_id}", response_model=EntityOut)
def get_yt_log(item_id: int):
    item = store.get(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Log not found")
    return item


@router.post("", response_model=EntityOut, status_code=status.HTTP_201_CREATED)
def create_yt_log(payload: EntityCreate):
    return store.create(payload.model_dump())


@router.put("/{item_id}", response_model=EntityOut)
def update_yt_log(item_id: int, payload: EntityUpdate):
    item = store.update(item_id, payload.model_dump(exclude_unset=True))
    if item is None:
        raise HTTPException(status_code=404, detail="Log not found")
    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_yt_log(item_id: int):
    ok = store.delete(item_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Log not found")
    return None
