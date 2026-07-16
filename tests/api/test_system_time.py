from datetime import datetime

from fastapi.testclient import TestClient

from app.main import create_app


def test_system_time_returns_beijing_server_timestamp() -> None:
    with TestClient(create_app()) as client:
        response = client.get("/api/system/time")

    assert response.status_code == 200
    payload = response.json()
    assert payload["timeZone"] == "Asia/Shanghai"
    assert isinstance(payload["epochMs"], int)
    parsed = datetime.fromisoformat(payload["iso"])
    assert parsed.utcoffset().total_seconds() == 8 * 60 * 60
    assert abs(int(parsed.timestamp() * 1000) - payload["epochMs"]) < 1000
