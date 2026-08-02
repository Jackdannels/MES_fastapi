from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.core.storage_backend import get_storage_health_report
from app.db.session import get_connection
from app.db.schema_version import require_schema_version
from app.services.capacity_diagnostics import CapacityThresholds, collect_capacity_diagnostics

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live")
def health_live():
    return {"status": "ok"}


@router.get("")
def health():
    report = get_storage_health_report()
    return {"status": "ok", "storage": report}


@router.get("/db")
def health_db():
    try:
        conn = get_connection()
    except RuntimeError as exc:
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "detail": str(exc),
            },
        )
    try:
        cursor = conn.cursor()
        try:
            cursor.execute("select 1")
            row = cursor.fetchone()
        finally:
            cursor.close()
    finally:
        conn.close()

    return {"status": "ok", "result": row[0] if row else None}


@router.get("/ready")
def health_ready(request: Request):
    details: dict[str, object] = {}
    try:
        conn = get_connection()
        try:
            cursor = conn.cursor()
            try:
                app_settings = getattr(request.app.state, "settings", None)
                require_schema_version(
                    cursor,
                    app_env=getattr(app_settings, "APP_ENV", None),
                )
            finally:
                cursor.close()
        finally:
            conn.close()
        details["database"] = {"status": "ok"}
    except Exception as exc:
        details["database"] = {"status": "unhealthy", "detail": str(exc)}

    rabbit_runtime = getattr(request.app.state, "lims_rabbit_runtime", None)
    rabbit_status = rabbit_runtime.status() if rabbit_runtime is not None else {"enabled": False, "connected": False}
    rabbit_ready = not bool(rabbit_status.get("enabled")) or bool(rabbit_status.get("connected"))
    details["rabbitmq"] = {
        "status": "ok" if rabbit_ready else "unhealthy",
        **rabbit_status,
    }

    mqtt_runtime = getattr(request.app.state, "mq_runtime", None)
    mqtt_status = (
        mqtt_runtime.status()
        if mqtt_runtime is not None
        else {"mqtt_enabled": False, "subscriber_running": False}
    )
    mqtt_ready = not bool(mqtt_status.get("mqtt_enabled")) or bool(
        mqtt_status.get("subscriber_running")
    )
    details["mqtt"] = {
        "status": "ok" if mqtt_ready else "unhealthy",
        **mqtt_status,
    }

    ready = details["database"].get("status") == "ok" and rabbit_ready and mqtt_ready
    return JSONResponse(
        status_code=200 if ready else 503,
        content={"status": "ready" if ready else "unavailable", **details},
    )


@router.get("/rabbitmq")
def health_rabbitmq(request: Request):
    runtime = getattr(request.app.state, "lims_rabbit_runtime", None)
    status = runtime.status() if runtime is not None else {"enabled": False, "connected": False, "last_error": "runtime unavailable"}
    response_status = 200 if not status.get("enabled") or status.get("connected") else 503
    return JSONResponse(status_code=response_status, content={"status": "ok" if response_status == 200 else "unhealthy", **status})


@router.get("/capacity")
def health_capacity(request: Request):
    retention_runtime = getattr(request.app.state, "data_retention_runtime", None)
    retention_status = None
    if retention_runtime is not None:
        status_reader = getattr(retention_runtime, "status", None)
        if callable(status_reader):
            retention_status = status_reader()
    try:
        app_settings = getattr(request.app.state, "settings", None)
        report = collect_capacity_diagnostics(
            get_connection,
            retention_status=retention_status if isinstance(retention_status, dict) else None,
            thresholds=CapacityThresholds.from_settings(app_settings) if app_settings is not None else None,
        )
    except Exception as exc:
        return JSONResponse(
            status_code=503,
            content={"status": "unhealthy", "detail": str(exc)},
        )
    return report
