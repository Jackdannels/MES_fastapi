from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import API_ROUTERS
from app.core.config import Settings, settings
from app.web import routes as web_routes


def create_app(app_settings: Settings | None = None) -> FastAPI:
    configured_settings = app_settings or settings
    app = FastAPI(title=configured_settings.APP_NAME, debug=configured_settings.DEBUG)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[origin.strip() for origin in configured_settings.FRONTEND_ORIGINS.split(",") if origin.strip()],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    if configured_settings.SERVE_WEB_APP and web_routes.FRONTEND_ASSETS_DIR.exists():
        app.mount("/assets", StaticFiles(directory=str(web_routes.FRONTEND_ASSETS_DIR)), name="assets")

    for router in API_ROUTERS:
        app.include_router(router)

    app.include_router(web_routes.build_web_router(configured_settings.SERVE_WEB_APP))
    return app


app = create_app()
