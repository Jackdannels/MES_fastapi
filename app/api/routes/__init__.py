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
from app.api.routes.technologies import router as technologies_router
from app.api.routes.warehouse import router as warehouse_router
from app.api.routes.workflows import router as workflows_router
from app.api.routes.yt_barcode import router as yt_barcode_router
from app.api.routes.yt_file import router as yt_file_router
from app.api.routes.yt_log import router as yt_log_router
from app.api.routes.yt_object import router as yt_object_router
from app.api.routes.yt_report import router as yt_report_router
from app.api.routes.yt_timesheet import router as yt_timesheet_router

API_ROUTERS = [
    auth_router,
    health_router,
    person_router,
    customer_router,
    companydepartment_router,
    permissions_router,
    workflows_router,
    technologies_router,
    yt_file_router,
    yt_timesheet_router,
    yt_log_router,
    warehouse_router,
    productcatalog_router,
    yt_report_router,
    quality_router,
    manufactureplan_router,
    report_router,
    device_router,
    material_router,
    storage_router,
    yt_barcode_router,
    yt_object_router,
]

__all__ = ["API_ROUTERS"]
