from fastapi import APIRouter, Request

from app.services.laboratory_telemetry import laboratory_telemetry_store


router = APIRouter(prefix="/api/telemetry", tags=["telemetry"])


@router.get("/laboratories")
def list_laboratory_telemetry(request: Request) -> dict[str, object]:
    runtime = getattr(request.app.state, "mq_runtime", None)
    connected = bool(runtime and runtime.status().get("subscriber_running"))
    return {
        "monitor_status": "online" if connected else "offline",
        "monitor_message": "" if connected else "MQTT 接收链路中断，设备状态暂不可确认",
        "items": laboratory_telemetry_store.list(),
        "delayed_after_seconds": laboratory_telemetry_store.delayed_after,
        "offline_after_seconds": laboratory_telemetry_store.offline_after,
        "refresh_interval_seconds": 1,
    }
