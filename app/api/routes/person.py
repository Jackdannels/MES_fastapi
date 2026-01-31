from fastapi import APIRouter

router = APIRouter(prefix="/person", tags=["person"])


@router.get("")
def list_person():
    return {"items": []}


@router.post("")
def create_person():
    return {"id": 1}
