from dataclasses import dataclass

from fastapi import APIRouter

from app.api.routes.attendance import router as attendance_router
from app.api.routes.auth import router as auth_router
from app.api.routes.resource_inventory import router as resource_inventory_router
from app.api.routes.health import router as health_router
from app.api.routes.laboratory import router as laboratory_router
from app.api.routes.master_data import router as master_data_router
from app.api.routes.mq import router as mq_router
from app.api.routes.samples import router as samples_router
from app.api.routes.storage import router as storage_router
from app.api.routes.system_time import router as system_time_router
from app.api.routes.telemetry import router as telemetry_router
from app.api.routes.task_history import router as task_history_router
from app.api.routes.tasks import router as tasks_router
from app.api.routes.test_data import router as test_data_router
from app.api.routes.terminal_control import router as terminal_control_router
from app.api.routes.transfer_area import router as transfer_area_router


@dataclass(frozen=True)
class AppModule:
    key: str
    api_routers: tuple[APIRouter, ...] = ()
    spa_routes: tuple[str, ...] = ()


MODULES = (
    AppModule(key="auth", api_routers=(auth_router,), spa_routes=("/login",)),
    AppModule(key="dashboard", api_routers=(health_router,), spa_routes=("/",)),
    AppModule(key="master-data", api_routers=(master_data_router,)),
    AppModule(key="task-overview", spa_routes=("/task-overview",)),
    AppModule(
        key="tasks",
        api_routers=(tasks_router, task_history_router),
        spa_routes=("/tasks",),
    ),
    AppModule(
        key="schedule",
        spa_routes=("/schedule",),
    ),
    AppModule(
        key="samples",
        api_routers=(samples_router,),
        spa_routes=("/samples",),
    ),
    AppModule(key="handover-system", api_routers=(transfer_area_router,), spa_routes=("/handover-system",)),
    AppModule(
        key="process",
        spa_routes=("/process",),
    ),
    AppModule(
        key="devices",
        api_routers=(storage_router, resource_inventory_router),
        spa_routes=("/devices",),
    ),
    AppModule(key="data", api_routers=(test_data_router,), spa_routes=("/data",)),
    AppModule(key="system", api_routers=(attendance_router, system_time_router, terminal_control_router), spa_routes=("/system",)),
    AppModule(key="visualization", api_routers=(telemetry_router,), spa_routes=("/visualization",)),
    AppModule(key="staging-management", spa_routes=("/staging-management",)),
    AppModule(key="appearance-inspection", spa_routes=("/appearance-inspection",)),
    AppModule(key="laboratory", api_routers=(mq_router, laboratory_router), spa_routes=("/laboratory",)),
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
        "appearance-inspection",
        "laboratory",
    )
    ordered_modules = {module.key: module for module in MODULES}
    return tuple(route for key in ordered_keys for route in ordered_modules[key].spa_routes)


API_ROUTERS = get_api_routers()
SPA_ROUTES = get_spa_routes()
