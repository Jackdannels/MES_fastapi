from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, PlainTextResponse

BASE_DIR = Path(__file__).resolve().parents[1]
SPA_INDEX = BASE_DIR / "static" / "dist" / "index.html"

router = APIRouter()


def spa_response() -> FileResponse:
    if SPA_INDEX.exists():
        return FileResponse(SPA_INDEX)
    return PlainTextResponse(
        "Frontend build missing. Run `cd frontend` and `npm run build` first.",
        status_code=500,
    )


@router.get("/")
def dashboard(request: Request):
    return spa_response()


@router.get("/tasks")
def tasks(request: Request):
    return spa_response()


@router.get("/schedule")
def schedule(request: Request):
    return spa_response()


@router.get("/samples")
def samples(request: Request):
    return spa_response()


@router.get("/process")
def process(request: Request):
    return spa_response()


@router.get("/devices")
def devices(request: Request):
    return spa_response()


@router.get("/data")
def data(request: Request):
    return spa_response()


@router.get("/system")
def system(request: Request):
    return spa_response()
