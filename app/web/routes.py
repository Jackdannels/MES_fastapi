from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, PlainTextResponse

BASE_DIR = Path(__file__).resolve().parents[1]
SPA_INDEX = BASE_DIR / "static" / "dist" / "index.html"
SPA_ROUTES = (
    "/",
    "/login",
    "/task-overview",
    "/tasks",
    "/schedule",
    "/samples",
    "/process",
    "/devices",
    "/data",
    "/system",
    "/visualization",
    "/staging-management",
)

router = APIRouter()


def spa_response() -> FileResponse:
    if SPA_INDEX.exists():
        return FileResponse(SPA_INDEX)
    return PlainTextResponse(
        "Frontend build missing. Run `cd frontend` and `npm run build` first.",
        status_code=500,
    )

for route_path in SPA_ROUTES:
    router.add_api_route(route_path, spa_response, methods=["GET"])
