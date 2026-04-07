from dataclasses import dataclass

from fastapi import APIRouter

from app.api.routes.auth import router as auth_router
from app.api.routes.companydepartment import router as companydepartment_router
from app.api.routes.customer import router as customer_router
from app.api.routes.device import router as device_router
from app.api.routes.health import router as health_router
from app.api.routes.manufactureplan import router as manufactureplan_router
from app.api.routes.material import router as material_router
from app.api.routes.permissions import router as permissions_router
from app.api.routes.person import router as person_router
from app.api.routes.productcatalog import router as productcatalog_router
from app.api.routes.quality import router as quality_router
from app.api.routes.report import router as report_router
from app.api.routes.storage import router as storage_router
from app.api.routes.tasks import router as tasks_router
from app.api.routes.technologies import router as technologies_router
from app.api.routes.transfer_area import router as transfer_area_router
from app.api.routes.warehouse import router as warehouse_router
from app.api.routes.workflows import router as workflows_router
from app.api.routes.yt_barcode import router as yt_barcode_router
from app.api.routes.yt_file import router as yt_file_router
from app.api.routes.yt_log import router as yt_log_router
from app.api.routes.yt_object import router as yt_object_router
from app.api.routes.yt_report import router as yt_report_router
from app.api.routes.yt_timesheet import router as yt_timesheet_router


@dataclass(frozen=True)
class AppModule:
    key: str
    api_routers: tuple[APIRouter, ...] = ()
    spa_routes: tuple[str, ...] = ()


MODULES = (
    AppModule(key="auth", api_routers=(auth_router,), spa_routes=("/login",)),
    AppModule(key="dashboard", api_routers=(health_router,), spa_routes=("/",)),
    AppModule(key="task-overview", spa_routes=("/task-overview",)),
    AppModule(
        key="tasks",
        api_routers=(tasks_router, person_router, customer_router, companydepartment_router, permissions_router),
        spa_routes=("/tasks",),
    ),
    AppModule(
        key="schedule",
        api_routers=(workflows_router, technologies_router, yt_file_router, yt_timesheet_router, yt_log_router),
        spa_routes=("/schedule",),
    ),
    AppModule(
        key="samples",
        api_routers=(warehouse_router, productcatalog_router, yt_report_router, quality_router),
        spa_routes=("/samples",),
    ),
    AppModule(key="handover-system", api_routers=(transfer_area_router,), spa_routes=("/handover-system",)),
    AppModule(
        key="process",
        api_routers=(manufactureplan_router, report_router, device_router),
        spa_routes=("/process",),
    ),
    AppModule(
        key="devices",
        api_routers=(material_router, storage_router),
        spa_routes=("/devices",),
    ),
    AppModule(key="data", api_routers=(yt_barcode_router, yt_object_router), spa_routes=("/data",)),
    AppModule(key="system", spa_routes=("/system",)),
    AppModule(key="visualization", spa_routes=("/visualization",)),
    AppModule(key="staging-management", spa_routes=("/staging-management",)),
    AppModule(key="laboratory", spa_routes=("/laboratory",)),
)


def get_api_routers() -> list[APIRouter]:
    routers: list[APIRouter] = []
    for module in MODULES:
        routers.extend(module.api_routers)
    return routers


def get_spa_routes() -> tuple[str, ...]:
    ordered_keys = (
        "dashboard",
        "auth",
        "task-overview",
        "tasks",
        "schedule",
        "samples",
        "handover-system",
        "process",
        "devices",
        "data",
        "system",
        "visualization",
        "staging-management",
        "laboratory",
    )
    ordered_modules = {module.key: module for module in MODULES}
    return tuple(route for key in ordered_keys for route in ordered_modules[key].spa_routes)


API_ROUTERS = get_api_routers()
SPA_ROUTES = get_spa_routes()
