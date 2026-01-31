from fastapi import APIRouter

router = APIRouter(prefix="/yt_file", tags=["yt_file"])


@router.get("")
def list_yt_file():
    return {"items": []}


@router.post("")
def create_yt_file():
    return {"id": 1}
