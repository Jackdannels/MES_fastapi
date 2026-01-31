from fastapi import APIRouter

router = APIRouter(prefix="/yt_barcode", tags=["yt_barcode"])


@router.get("")
def list_yt_barcode():
    return {"items": []}


@router.post("")
def create_yt_barcode():
    return {"id": 1}
