from app.api.routes.crud_factory import build_crud_router

router = build_crud_router("/yt_timesheet", "yt_timesheet", "YtTimesheet")
