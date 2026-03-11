from app.api.routes import API_ROUTERS


def test_api_router_registry_exposes_expected_prefixes():
    assert [router.prefix for router in API_ROUTERS] == [
        "/auth",
        "/health",
        "/person",
        "/customer",
        "/companydepartment",
        "/permissions",
        "/workflows",
        "/technologies",
        "/yt_file",
        "/yt_timesheet",
        "/yt_log",
        "/warehouse",
        "/productcatalog",
        "/yt_report",
        "/quality",
        "/manufactureplan",
        "/report",
        "/device",
        "/material",
        "/api/storage",
        "/yt_barcode",
        "/yt_object",
    ]
