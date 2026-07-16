from app.modules.registry import API_ROUTERS, MODULES, SPA_ROUTES


def test_module_registry_exposes_modules_api_routers_and_spa_routes():
    assert len(MODULES) > 0
    assert len(API_ROUTERS) > 0
    assert len(SPA_ROUTES) > 0


def test_module_registry_preserves_expected_route_surfaces():
    assert [router.prefix for router in API_ROUTERS] == [
        "/auth",
        "/health",
        "/api/master",
        "/api/tasks",
        "/api/task-history",
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
        "/api/transfer-area",
        "/manufactureplan",
        "/report",
        "/device",
        "/material",
        "/api/storage",
        "/yt_barcode",
        "/yt_object",
        "/api/attendance",
        "/api/system",
        "/api/mq",
        "/api/laboratory",
    ]
    assert SPA_ROUTES == (
        "/",
        "/login",
        "/task-overview",
        "/tasks",
        "/schedule",
        "/samples",
        "/handover-system",
        "/process",
        "/devices",
        "/data",
        "/system",
        "/visualization",
        "/staging-management",
        "/appearance-inspection",
        "/laboratory",
    )
