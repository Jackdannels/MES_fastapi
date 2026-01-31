from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.routes.health import router as health_router
from app.api.routes.person import router as person_router
from app.api.routes.customer import router as customer_router
from app.api.routes.companydepartment import router as companydepartment_router
from app.api.routes.permissions import router as permissions_router
from app.api.routes.workflows import router as workflows_router
from app.api.routes.technologies import router as technologies_router
from app.api.routes.yt_file import router as yt_file_router
from app.api.routes.yt_timesheet import router as yt_timesheet_router
from app.api.routes.yt_log import router as yt_log_router
from app.api.routes.warehouse import router as warehouse_router
from app.api.routes.productcatalog import router as productcatalog_router
from app.api.routes.yt_report import router as yt_report_router
from app.api.routes.quality import router as quality_router
from app.api.routes.manufactureplan import router as manufactureplan_router
from app.api.routes.report import router as report_router
from app.api.routes.device import router as device_router
from app.api.routes.material import router as material_router
from app.api.routes.storage import router as storage_router
from app.api.routes.yt_barcode import router as yt_barcode_router
from app.api.routes.yt_object import router as yt_object_router
from app.core.config import settings
from app.web.routes import router as web_router

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(title=settings.APP_NAME, debug=settings.DEBUG)

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

app.include_router(health_router)
app.include_router(person_router)
app.include_router(customer_router)
app.include_router(companydepartment_router)
app.include_router(permissions_router)
app.include_router(workflows_router)
app.include_router(technologies_router)
app.include_router(yt_file_router)
app.include_router(yt_timesheet_router)
app.include_router(yt_log_router)
app.include_router(warehouse_router)
app.include_router(productcatalog_router)
app.include_router(yt_report_router)
app.include_router(quality_router)
app.include_router(manufactureplan_router)
app.include_router(report_router)
app.include_router(device_router)
app.include_router(material_router)
app.include_router(storage_router)
app.include_router(yt_barcode_router)
app.include_router(yt_object_router)
app.include_router(web_router)
