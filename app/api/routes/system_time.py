from fastapi import APIRouter

from app.core.time_utils import BEIJING_TZ, now_business_datetime


router = APIRouter(prefix="/api/system", tags=["system-time"])


@router.get("/time")
def read_system_time() -> dict[str, int | str]:
    current = now_business_datetime().replace(tzinfo=BEIJING_TZ)
    return {
        "epochMs": int(current.timestamp() * 1000),
        "iso": current.isoformat(timespec="milliseconds"),
        "timeZone": "Asia/Shanghai",
    }


@router.get("/discovery")
def read_mes_discovery() -> dict[str, int | str]:
    return {
        "service": "MES_FASTAPI",
        "apiVersion": 1,
        "frontendPort": 5173,
    }
