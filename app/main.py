from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import Settings, settings
from app.modules.registry import API_ROUTERS
from app.services.mq_runtime import MqttRuntimeController
from app.services.upper_computer_simulator import restart_upper_computer_simulator_auto_mode, stop_upper_computer_simulator
from app.web import routes as web_routes


def create_app(app_settings: Settings | None = None) -> FastAPI:
    configured_settings = app_settings or settings
    mq_runtime = MqttRuntimeController(configured_settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        _app.state.mq_runtime = mq_runtime
        try:
            if configured_settings.MQTT_ENABLED and configured_settings.UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE:
                restart_upper_computer_simulator_auto_mode(configured_settings)
                mq_runtime.set_mode("mqtt")
            yield
        finally:
            mq_runtime.shutdown()
            stop_upper_computer_simulator(configured_settings)

    app = FastAPI(title=configured_settings.APP_NAME, debug=configured_settings.DEBUG, lifespan=lifespan)
    app.state.mq_runtime = mq_runtime

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
