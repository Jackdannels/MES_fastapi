from fastapi.testclient import TestClient

from app.main import app
from app.services.laboratory_telemetry import laboratory_telemetry_store


client = TestClient(app)


def test_laboratory_telemetry_endpoint_returns_upper_computer_snapshot() -> None:
    laboratory_telemetry_store.clear()
    laboratory_telemetry_store.update(
        "mes/v1/labs/LAB_IMPACT_1/telemetry/snapshot",
        {
            "lab_code": "LAB_IMPACT_1",
            "boot_id": "BOOT-API",
            "sequence": 1,
            "environment": {"temperature_c": 22.8, "humidity_rh": 48.0, "quality": "good"},
            "test_device": {"online": True, "temperature_c": 30.1, "voltage_v": 220.2},
            "carrier_device": {"configured": True, "online": True, "temperature_c": 29.1, "voltage_v": 221.0},
        },
    )

    response = client.get("/api/telemetry/laboratories")

    assert response.status_code == 200
    assert response.json()["items"][0]["lab_code"] == "LAB_IMPACT_1"
    assert response.json()["items"][0]["connection_status"] == "online"
    assert response.json()["refresh_interval_seconds"] == 3
