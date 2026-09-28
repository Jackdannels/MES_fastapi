from datetime import datetime

from fastapi.testclient import TestClient

from app.main import create_app
from app.core.config import Settings


def offline_app():
    # Time/discovery contracts must not start devices or depend on the host .env.
    return create_app(Settings(
        _env_file=None, MQTT_ENABLED=False, RABBITMQ_ENABLED=False,
        UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE=False,
        LIMS_COMMUNICATION_ENABLED=False, RETENTION_ENABLED=False,
    ))


def test_system_time_returns_beijing_server_timestamp() -> None:
    with TestClient(offline_app()) as client:
        response = client.get("/api/system/time")

    assert response.status_code == 200
    payload = response.json()
    assert payload["timeZone"] == "Asia/Shanghai"
    assert isinstance(payload["epochMs"], int)
    parsed = datetime.fromisoformat(payload["iso"])
    assert parsed.utcoffset().total_seconds() == 8 * 60 * 60
    assert abs(int(parsed.timestamp() * 1000) - payload["epochMs"]) < 1000


def test_mes_discovery_exposes_stable_service_marker() -> None:
    with TestClient(offline_app()) as client:
        response = client.get("/api/system/discovery")

    assert response.status_code == 200
    assert response.json() == {
        "service": "MES_FASTAPI",
        "apiVersion": 1,
        "frontendPort": 5173,
    }
