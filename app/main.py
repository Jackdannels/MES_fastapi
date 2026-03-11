from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.routes import API_ROUTERS
from app.core.config import settings
from app.web.routes import router as web_router

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(title=settings.APP_NAME, debug=settings.DEBUG)

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

for router in API_ROUTERS:
    app.include_router(router)

app.include_router(web_router)
