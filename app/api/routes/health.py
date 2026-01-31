from fastapi import APIRouter

from app.db.session import get_connection

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
def health():
    return {"status": "ok"}


@router.get("/db")
def health_db():
    conn = get_connection()
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
