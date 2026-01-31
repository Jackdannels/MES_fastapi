from fastapi import APIRouter

router = APIRouter(prefix="/companydepartment", tags=["companydepartment"])


@router.get("")
def list_companydepartment():
    return {"items": []}


@router.post("")
def create_companydepartment():
    return {"id": 1}
