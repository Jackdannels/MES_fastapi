import pytest

from app.api.auth_session import build_auth_session, dump_auth_session
from app.api.routes import test_data as route
from app.core.config import settings
from app.main import app


@pytest.fixture
def authorized(client, tmp_path, monkeypatch):
    client.cookies.set(settings.SESSION_COOKIE_NAME, dump_auth_session(build_auth_session(username="operator", module="central")))
    monkeypatch.setattr(app.state.test_data_backup_runtime.settings, "TEST_DATA_BACKUP_STATE_PATH", str(tmp_path / "queue.sqlite3"))
    monkeypatch.setattr(app.state.test_data_backup_runtime.settings, "TEST_DATA_BACKUP_PATH", str(tmp_path / "old"))
    monkeypatch.setattr(route, "_backup_local_roots", lambda: [str(tmp_path / "local")])
    return client


def test_new_write_and_probe_endpoints_require_central_login(client):
    for url in ("backup-check", "backup-select-directory"):
        assert client.post(f"/api/test-data/{url}", json={"backupPath": "x"}).status_code == 401
    client.cookies.set(settings.SESSION_COOKIE_NAME, dump_auth_session(build_auth_session(username="operator", module="laboratory")))
    assert client.put("/api/test-data/backup-settings", json={"backupPath": "x"}).status_code == 403


def test_check_does_not_save_and_save_rechecks(authorized, tmp_path, monkeypatch):
    calls = []
    destination = str(tmp_path / "new")
    def check(path, roots):
        calls.append((path, roots))
        return {"ok": True, "path": destination, "detail": "通过", "checks": []}
    monkeypatch.setattr(route, "check_backup_directory", check)
    assert authorized.post("/api/test-data/backup-check", json={"backupPath": destination}).json()["ok"]
    assert app.state.test_data_backup_runtime.destination == str(tmp_path / "old")
    response = authorized.put("/api/test-data/backup-settings", json={"backupPath": destination})
    assert response.status_code == 200
    assert response.json()["destination"] == destination
    assert len(calls) == 2


def test_failed_check_preserves_effective_destination(authorized, tmp_path, monkeypatch):
    monkeypatch.setattr(route, "check_backup_directory", lambda *a: {"ok": False, "path": "bad", "detail": "拒绝访问", "checks": []})
    response = authorized.put("/api/test-data/backup-settings", json={"backupPath": "bad"})
    assert response.status_code == 400
    assert response.json()["probe"]["ok"] is False
    assert app.state.test_data_backup_runtime.destination == str(tmp_path / "old")


def test_backup_picker_is_separate_and_cancellable(authorized, monkeypatch):
    monkeypatch.setattr(route, "select_test_data_directory", lambda *a, **k: {"savePath": "", "cancelled": True})
    assert authorized.post("/api/test-data/backup-select-directory", json={"backupPath": ""}).json() == {"backupPath": "", "cancelled": True}


def test_backup_picker_rejects_remote_control(authorized, monkeypatch):
    monkeypatch.setattr(route, "is_loopback_client", lambda _: False)
    response = authorized.post("/api/test-data/backup-select-directory", json={"backupPath": ""})
    assert response.status_code == 403
