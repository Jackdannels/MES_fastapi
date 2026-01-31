from fastapi import APIRouter

router = APIRouter(prefix="/productcatalog", tags=["productcatalog"])


@router.get("")
def list_productcatalog():
    return {"items": []}


@router.post("")
def create_productcatalog():
    return {"id": 1}
