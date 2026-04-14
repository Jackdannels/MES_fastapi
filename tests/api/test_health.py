from app.api.routes import health as health_routes


def test_health_db_returns_unhealthy_response_when_connection_fails(client, monkeypatch):
    def fail_connection():
        raise RuntimeError("dmPython is not installed")

    monkeypatch.setattr(health_routes, "get_connection", fail_connection)

    response = client.get("/health/db")

    assert response.status_code == 503
    assert response.json() == {
        "status": "unhealthy",
        "detail": "dmPython is not installed",
    }


def test_health_reports_storage_diagnostics(client, monkeypatch):
    monkeypatch.setattr(
        health_routes,
        "get_storage_health_report",
        lambda: {
            "status": "ok",
            "configured_backend": "mysql",
            "active_backend": "mysql",
            "database": {"status": "ok", "result": 1},
            "mysql": {"status": "ok", "result": 1},
            "bootstrap": {
                "from_json_enabled": False,
                "source_path": "C:/tmp/mes_store.json",
                "last_result": "disabled",
            },
        },
    )

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "storage": {
            "status": "ok",
            "configured_backend": "mysql",
            "active_backend": "mysql",
            "database": {"status": "ok", "result": 1},
            "mysql": {"status": "ok", "result": 1},
            "bootstrap": {
                "from_json_enabled": False,
                "source_path": "C:/tmp/mes_store.json",
                "last_result": "disabled",
            },
        },
    }


def test_health_surfaces_storage_backend_unhealthy_details_without_failing_health_endpoint(client, monkeypatch):
    monkeypatch.setattr(
        health_routes,
        "get_storage_health_report",
        lambda: {
            "status": "unhealthy",
            "configured_backend": "mysql",
            "active_backend": None,
            "database": {
                "status": "unhealthy",
                "detail": "pymysql is required for the MySQL storage backend",
            },
            "mysql": {
                "status": "unhealthy",
                "detail": "pymysql is required for the MySQL storage backend",
            },
            "bootstrap": {
                "from_json_enabled": False,
                "source_path": "C:/tmp/mes_store.json",
                "last_result": "disabled",
            },
        },
    )

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "storage": {
            "status": "unhealthy",
            "configured_backend": "mysql",
            "active_backend": None,
            "database": {
                "status": "unhealthy",
                "detail": "pymysql is required for the MySQL storage backend",
            },
            "mysql": {
                "status": "unhealthy",
                "detail": "pymysql is required for the MySQL storage backend",
            },
            "bootstrap": {
                "from_json_enabled": False,
                "source_path": "C:/tmp/mes_store.json",
                "last_result": "disabled",
            },
        },
    }
