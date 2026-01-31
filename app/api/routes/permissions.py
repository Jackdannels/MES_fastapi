from fastapi import APIRouter

router = APIRouter(prefix="/permissions", tags=["permissions"])


@router.get("")
def list_permissions():
    return {"items": []}


@router.post("")
def create_permissions():
    return {"id": 1}
