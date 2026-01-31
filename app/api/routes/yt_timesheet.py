from fastapi import APIRouter

router = APIRouter(prefix="/yt_timesheet", tags=["yt_timesheet"])


@router.get("")
def list_yt_timesheet():
    return {"items": []}


@router.post("")
def create_yt_timesheet():
    return {"id": 1}
