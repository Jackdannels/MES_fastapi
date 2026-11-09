from app.modules.registry import API_ROUTERS


def test_api_router_registry_exposes_expected_prefixes():
    assert [router.prefix for router in API_ROUTERS] == [
        "/auth",
        "/health",
        "/api/master",
        "/api/tasks",
        "/api/task-history",
        "/api/samples",
        "/api/transfer-area",
        "/api/storage",
        "/api/device-resources",
        "/api/test-data",
        "/api/attendance",
        "/api/system",
        "/api/terminal-control",
        "/api/telemetry",
        "/api/mq",
        "/api/laboratory",
    ]
