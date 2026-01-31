from fastapi import APIRouter

router = APIRouter(prefix="/customer", tags=["customer"])


@router.get("")
def list_customer():
    return {"items": []}


@router.post("")
def create_customer():
    return {"id": 1}
