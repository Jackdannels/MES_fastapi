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


def test_health_live_does_not_depend_on_external_services(client):
    response = client.get("/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_ready_requires_database_schema_and_enabled_rabbitmq(client, monkeypatch):
    class Cursor:
        def close(self):
            return None

    class Connection:
        def cursor(self):
            return Cursor()

        def close(self):
            return None

    class RabbitRuntime:
        def status(self):
            return {"enabled": True, "connected": True}

    class MqttRuntime:
        def status(self):
            return {"mqtt_enabled": False, "subscriber_running": False}

    monkeypatch.setattr(health_routes, "get_connection", lambda: Connection())
    monkeypatch.setattr(
        health_routes,
        "require_schema_version",
        lambda cursor, **_kwargs: None,
    )
    client.app.state.lims_rabbit_runtime = RabbitRuntime()
    client.app.state.mq_runtime = MqttRuntime()

    response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json()["status"] == "ready"
    assert response.json()["database"] == {"status": "ok"}
    assert response.json()["rabbitmq"]["connected"] is True


def test_health_ready_returns_503_for_schema_failure(client, monkeypatch):
    class Cursor:
        def close(self):
            return None

    class Connection:
        def cursor(self):
            return Cursor()

        def close(self):
            return None

    monkeypatch.setattr(health_routes, "get_connection", lambda: Connection())
    monkeypatch.setattr(
        health_routes,
        "require_schema_version",
        lambda cursor, **_kwargs: (_ for _ in ()).throw(RuntimeError("V005 required")),
    )

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json()["status"] == "unavailable"
    assert response.json()["database"] == {"status": "unhealthy", "detail": "V005 required"}


def test_health_ready_returns_503_when_enabled_mqtt_subscriber_is_not_connected(client, monkeypatch):
    class Cursor:
        def close(self):
            return None

    class Connection:
        def cursor(self):
            return Cursor()

        def close(self):
            return None

    class MqttRuntime:
        def status(self):
            return {"mqtt_enabled": True, "subscriber_running": False, "reason": "not_connected"}

    monkeypatch.setattr(health_routes, "get_connection", lambda: Connection())
    monkeypatch.setattr(health_routes, "require_schema_version", lambda cursor, **_kwargs: None)
    client.app.state.mq_runtime = MqttRuntime()

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json()["mqtt"]["status"] == "unhealthy"


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
        },
    }


def test_health_capacity_includes_retention_runtime_status(client, monkeypatch):
    class RetentionRuntime:
        def status(self):
            return {"enabled": True, "running": False, "lastError": ""}

    captured = {}

    def collect(_connection_factory, *, retention_status=None, thresholds=None):
        captured["retention"] = retention_status
        captured["thresholds"] = thresholds
        return {"status": "ok", "warnings": [], "retention": retention_status}

    monkeypatch.setattr(health_routes, "collect_capacity_diagnostics", collect)
    client.app.state.data_retention_runtime = RetentionRuntime()

    response = client.get("/health/capacity")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert captured["retention"]["enabled"] is True
    assert captured["thresholds"].pool_utilization == 0.8


def test_health_capacity_returns_503_when_diagnostics_fail(client, monkeypatch):
    monkeypatch.setattr(
        health_routes,
        "collect_capacity_diagnostics",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("capacity query failed")),
    )

    response = client.get("/health/capacity")

    assert response.status_code == 503
    assert response.json() == {"status": "unhealthy", "detail": "capacity query failed"}
