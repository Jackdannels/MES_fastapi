import pytest

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


@pytest.fixture(autouse=True)
def stub_spa_index(tmp_path, monkeypatch):
    spa_index = tmp_path / "index.html"
    spa_index.write_text("<!doctype html><html><body>MES Test</body></html>", encoding="utf-8")
    monkeypatch.setattr(web_routes, "SPA_INDEX", spa_index)


def test_spa_routes_return_frontend_entry(client):
    for path in SPA_ROUTES:
        response = client.get(path)

        assert response.status_code == 200, path
        assert "text/html" in response.headers["content-type"], path


def test_unknown_api_path_still_returns_404(client):
    response = client.get("/api/does-not-exist")

    assert response.status_code == 404
