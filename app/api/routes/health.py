from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.core.storage_backend import get_storage_health_report
from app.db.session import get_connection

router = APIRouter(prefix="/health", tags=["health"])


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


@router.get("/rabbitmq")
def health_rabbitmq(request: Request):
    runtime = getattr(request.app.state, "lims_rabbit_runtime", None)
    status = runtime.status() if runtime is not None else {"enabled": False, "connected": False, "last_error": "runtime unavailable"}
    response_status = 200 if not status.get("enabled") or status.get("connected") else 503
    return JSONResponse(status_code=response_status, content={"status": "ok" if response_status == 200 else "unhealthy", **status})
