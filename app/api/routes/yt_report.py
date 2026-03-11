from app.api.routes.crud_factory import build_crud_router

router = build_crud_router("/yt_report", "yt_report", "Report")
