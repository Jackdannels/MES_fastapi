from app.services.laboratory_telemetry import LaboratoryTelemetryStore


def payload(sequence: int = 1) -> dict:
    return {
        "message_id": f"MSG-{sequence}",
        "boot_id": "BOOT-1",
        "sequence": sequence,
        "lab_code": "LAB_HOT_HUMID_2",
        "observed_at": "2026-09-16T14:30:05+08:00",
        "environment": {"temperature_c": 23.6, "humidity_rh": 51.2, "quality": "good"},
        "test_device": {"online": True, "temperature_c": 38.4, "voltage_v": 220.7},
        "carrier_device": {"configured": False},
    }


def test_telemetry_snapshot_ages_from_online_to_delayed_and_offline() -> None:
    store = LaboratoryTelemetryStore()
    store.update("mes/v1/labs/LAB_HOT_HUMID_2/telemetry/snapshot", payload(), received_monotonic=100)

    assert store.list(now_monotonic=114)[0]["connection_status"] == "online"
    assert store.list(now_monotonic=115)[0]["connection_status"] == "delayed"
    assert store.list(now_monotonic=130)[0]["connection_status"] == "offline"
    assert store.list(now_monotonic=130)[0]["carrier_device"] == {
        "configured": False,
        "online": False,
        "temperature_c": None,
        "voltage_v": None,
        "alarm_code": None,
    }


def test_telemetry_ignores_out_of_order_sequence_within_same_boot() -> None:
    store = LaboratoryTelemetryStore()
    latest = payload(2)
    latest["environment"]["temperature_c"] = 25.0
    stale = payload(1)
    stale["environment"]["temperature_c"] = 18.0

    store.update("mes/v1/labs/LAB_HOT_HUMID_2/telemetry/snapshot", latest, received_monotonic=100)
    store.update("mes/v1/labs/LAB_HOT_HUMID_2/telemetry/snapshot", stale, received_monotonic=101)

    assert store.list(now_monotonic=101)[0]["environment"]["temperature_c"] == 25.0


def test_telemetry_rejects_topic_payload_laboratory_mismatch() -> None:
    store = LaboratoryTelemetryStore()

    try:
        store.update("mes/v1/labs/LAB_SALT/telemetry/snapshot", payload(), received_monotonic=100)
    except ValueError as exc:
        assert "do not match" in str(exc)
    else:
        raise AssertionError("mismatched telemetry must be rejected")


def test_telemetry_builds_visible_high_temperature_and_low_voltage_alarms() -> None:
    store = LaboratoryTelemetryStore()
    alarming = payload()
    alarming["test_device"]["temperature_c"] = 68.5
    alarming["test_device"]["voltage_v"] = 82.0

    stored = store.update("mes/v1/labs/LAB_HOT_HUMID_2/telemetry/snapshot", alarming, received_monotonic=100)

    assert stored["has_alarm"] is True
    assert [alarm["code"] for alarm in stored["alarms"]] == [
        "TEST_DEVICE_TEMPERATURE_HIGH",
        "TEST_DEVICE_VOLTAGE_LOW",
    ]
    assert "温度过高" in stored["alarms"][0]["message"]
    assert "电压过低" in stored["alarms"][1]["message"]
