from fastapi import APIRouter

router = APIRouter(prefix="/yt_object", tags=["yt_object"])


@router.get("")
def list_yt_object():
    return {"items": []}


@router.post("")
def create_yt_object():
    return {"id": 1}
