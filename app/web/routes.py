from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, PlainTextResponse

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIST_DIR = REPO_ROOT / "frontend" / "dist"
FRONTEND_ASSETS_DIR = FRONTEND_DIST_DIR / "assets"
SPA_INDEX = FRONTEND_DIST_DIR / "index.html"
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


def spa_response() -> FileResponse:
    if SPA_INDEX.exists():
        return FileResponse(SPA_INDEX)
    return PlainTextResponse(
        "Frontend build missing. Run `cd frontend` and `npm run build` first.",
        status_code=500,
    )


def build_web_router(serve_web_app: bool) -> APIRouter:
    router = APIRouter()
    if not serve_web_app:
        return router

    for route_path in SPA_ROUTES:
        router.add_api_route(route_path, spa_response, methods=["GET"])

    return router
