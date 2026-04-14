from fastapi import APIRouter
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
