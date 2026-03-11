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
