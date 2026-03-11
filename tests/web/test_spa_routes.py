import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.web import routes as web_routes


SPA_ROUTES = (
    "/",
    "/login",
    "/task-overview",
    "/tasks",
    "/schedule",
    "/samples",
    "/process",
    "/devices",
    "/data",
    "/system",
    "/visualization",
    "/staging-management",
)


@pytest.fixture
def stub_frontend_dist(tmp_path, monkeypatch):
    dist_dir = tmp_path / "dist"
    assets_dir = dist_dir / "assets"
    assets_dir.mkdir(parents=True)

    spa_index = dist_dir / "index.html"
    spa_index.write_text("<!doctype html><html><body><div id='app'>MES Test</div></body></html>", encoding="utf-8")
    (assets_dir / "app.js").write_text("console.log('MES Test');", encoding="utf-8")

    monkeypatch.setattr(web_routes, "FRONTEND_DIST_DIR", dist_dir)
    monkeypatch.setattr(web_routes, "FRONTEND_ASSETS_DIR", assets_dir)
    monkeypatch.setattr(web_routes, "SPA_INDEX", spa_index)

    return dist_dir


def build_app(*, serve_web_app: bool) -> TestClient:
    settings = Settings(
        _env_file=None,
        APP_NAME="MES Test",
        DEBUG=True,
        DEMO_USER="test-admin",
        DEMO_PASSWORD="test-password",
        SESSION_SECRET_KEY="test-session-secret",
        FRONTEND_ORIGINS="http://127.0.0.1:5173,http://localhost:5173",
        SERVE_WEB_APP=serve_web_app,
    )
    return TestClient(create_app(settings))


def test_backend_defaults_to_api_only_surface():
    client = build_app(serve_web_app=False)

    assert client.get("/").status_code == 404
    assert client.get("/assets/app.js").status_code == 404
    assert client.get("/health").status_code == 200


def test_spa_routes_return_frontend_entry_when_enabled(stub_frontend_dist):
    client = build_app(serve_web_app=True)

    for path in SPA_ROUTES:
        response = client.get(path)

        assert response.status_code == 200, path
        assert "text/html" in response.headers["content-type"], path


def test_frontend_assets_are_served_from_frontend_dist_when_enabled(stub_frontend_dist):
    client = build_app(serve_web_app=True)

    response = client.get("/assets/app.js")

    assert response.status_code == 200
    assert "javascript" in response.headers["content-type"]


def test_unknown_api_path_still_returns_404():
    client = build_app(serve_web_app=False)

    response = client.get("/api/does-not-exist")

    assert response.status_code == 404
