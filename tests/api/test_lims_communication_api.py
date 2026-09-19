from types import SimpleNamespace
from unittest.mock import Mock, AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def test_monitor_api_requires_token_and_enqueues_actions_without_clearing_fault():
    app = create_app(Settings(_env_file=None, LIMS_HTTP_TOKEN="secret", LIMS_HTTP_CALLBACK_URL="http://lims/api/mes/events"))
    runtime = SimpleNamespace(enabled=True, status=lambda: {"phase": "offline", "alarm": "critical", "retry_count": 3},
                              repository=SimpleNamespace(command=Mock()))
    app.state.lims_communication_runtime = runtime
    client = TestClient(app, client=("192.0.2.1", 12345))
    assert client.get("/api/system/lims-communication").status_code == 401
    headers = {"Authorization": "Bearer secret"}
    response = client.get("/api/system/lims-communication", headers=headers)
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    assert client.post("/api/system/lims-communication", headers=headers, json={"action": "acknowledge"}).status_code == 202
    runtime.repository.command.assert_called_once_with("acknowledge")
    assert client.get("/api/system/lims-communication", headers=headers).json()["alarm"] == "critical"
    assert client.post("/api/system/lims-communication", headers=headers, json={"action": "delete"}).status_code == 422


@pytest.mark.parametrize("enabled", [True, False])
def test_mes_remains_available_when_broker_start_fails_only_with_communication_monitor(monkeypatch, enabled):
    import app.main as module
    monkeypatch.setattr(module.LimsRabbitRuntime, "start", AsyncMock(side_effect=RuntimeError("broker down")))
    monkeypatch.setattr(module.LimsRabbitRuntime, "stop", AsyncMock())
    monkeypatch.setattr(module.LimsHttpRuntime, "start", AsyncMock())
    monkeypatch.setattr(module.LimsHttpRuntime, "stop", AsyncMock())
    monkeypatch.setattr(module.DataRetentionRuntime, "start", lambda _: None)
    monkeypatch.setattr(module.DataRetentionRuntime, "stop", AsyncMock())
    monkeypatch.setattr(module, "shutdown_mqtt_publisher", lambda _: None)
    monkeypatch.setattr(module, "stop_upper_computer_simulator", lambda _: None)
    app = create_app(Settings(_env_file=None, APP_ENV="test", MQTT_ENABLED=False, RABBITMQ_ENABLED=True,
                             LIMS_HTTP_CALLBACK_URL="http://lims/api/mes/events", LIMS_COMMUNICATION_ENABLED=enabled))
    if enabled:
        with TestClient(app) as client:
            assert client.get("/health/live").status_code == 200
            assert client.get("/health/rabbitmq").status_code == 503
    else:
        with pytest.raises(RuntimeError, match="broker down"):
            with TestClient(app): pass
