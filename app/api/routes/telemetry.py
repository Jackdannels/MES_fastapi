from fastapi import APIRouter

from app.services.laboratory_telemetry import laboratory_telemetry_store


router = APIRouter(prefix="/api/telemetry", tags=["telemetry"])


@router.get("/laboratories")
def list_laboratory_telemetry() -> dict[str, object]:
    return {
        "items": laboratory_telemetry_store.list(),
        "delayed_after_seconds": 15,
        "offline_after_seconds": 30,
        "refresh_interval_seconds": 3,
    }
