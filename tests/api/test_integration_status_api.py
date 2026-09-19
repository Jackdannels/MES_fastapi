from app.api.routes import system_time as routes
from types import SimpleNamespace
from unittest.mock import Mock
import pytest
from app.api.auth_session import build_auth_session, dump_auth_session
from app.core.config import settings


def test_integration_status_api_reports_each_peer_without_caching(client, monkeypatch):
    monkeypatch.setattr(routes, "lims_connection_status", lambda _: {"state": "offline", "detail": "unreachable"})
    monkeypatch.setattr(routes, "upper_computer_connection_status", lambda _: {"state": "online", "detail": "fresh telemetry"})
    response = client.get("/api/system/integrations")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["lims"]["state"] == "offline"
    assert response.json()["upper_computer"]["state"] == "online"


def test_central_acknowledgement_requires_signed_session_and_only_queues_ack(client, monkeypatch):
    command = Mock()
    runtime = SimpleNamespace(enabled=True, repository=SimpleNamespace(command=command))
    monkeypatch.setattr(client.app.state, "lims_communication_runtime", runtime)
    path = "/api/system/integrations/lims/acknowledge"
    assert client.post(path).status_code == 401
    client.cookies.set(settings.SESSION_COOKIE_NAME, dump_auth_session(build_auth_session(username="operator", module="central")))
    response = client.post(path, json={})
    assert response.status_code == 202
    command.assert_called_once_with("acknowledge")
    assert response.json()["ok"] is True
    assert client.post(path, headers={"Origin": "http://evil.invalid"}).status_code == 403
    assert command.call_count == 1


@pytest.mark.parametrize("module", ["laboratory", "staging", "visual"])
def test_non_central_sessions_cannot_acknowledge_global_alarm(client, monkeypatch, module):
    command = Mock()
    monkeypatch.setattr(client.app.state, "lims_communication_runtime", SimpleNamespace(enabled=True, repository=SimpleNamespace(command=command)))
    client.cookies.set(settings.SESSION_COOKIE_NAME, dump_auth_session(build_auth_session(username="operator", module=module)))
    assert client.post("/api/system/integrations/lims/acknowledge").status_code == 403
    command.assert_not_called()


def test_acknowledgement_storage_failure_does_not_claim_success(client, monkeypatch):
    command = Mock(side_effect=RuntimeError("private connection detail"))
    monkeypatch.setattr(client.app.state, "lims_communication_runtime", SimpleNamespace(enabled=True, repository=SimpleNamespace(command=command)))
    client.cookies.set(settings.SESSION_COOKIE_NAME, dump_auth_session(build_auth_session(username="operator", module="central")))
    response = client.post("/api/system/integrations/lims/acknowledge")
    assert response.status_code == 503
    assert "private" not in response.text
