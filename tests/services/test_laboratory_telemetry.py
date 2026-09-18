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

    assert store.list(now_monotonic=104)[0]["connection_status"] == "online"
    assert store.list(now_monotonic=105)[0]["connection_status"] == "delayed"
    assert store.list(now_monotonic=115)[0]["connection_status"] == "offline"
    carrier = store.list(now_monotonic=115)[0]["carrier_device"]
    assert carrier["configured"] is False
    assert carrier["connection_status"] == "not_configured"
    assert carrier["temperature_c"] is None


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


def test_device_loss_preserves_last_values_and_requires_two_fresh_samples_to_recover():
    store = LaboratoryTelemetryStore()
    topic = "mes/v1/labs/LAB_HOT_HUMID_2/telemetry/snapshot"
    store.update(topic, payload(), received_monotonic=100)
    lost = payload(2)
    lost["test_device"].update(online=False, temperature_c=99, voltage_v=0)
    row = store.update(topic, lost, received_monotonic=101)
    assert row["connection_status"] == "online"
    assert row["environment"]["connection_status"] == "online"
    assert row["test_device"]["connection_status"] == "offline"
    assert row["test_device"]["last_values"]["temperature_c"] == 38.4
    assert row["alarms"] == []
    for sequence, expected in [(3, "recovering"), (4, "online")]:
        restored = payload(sequence)
        restored["observed_at"] = f"2026-09-16T14:30:0{sequence}+08:00"
        row = store.update(topic, restored, received_monotonic=100 + sequence)
        assert row["test_device"]["connection_status"] == expected


def test_host_loss_masks_downstream_state_and_recovers_only_on_two_new_messages():
    store = LaboratoryTelemetryStore()
    topic = "mes/v1/labs/LAB_HOT_HUMID_2/telemetry/snapshot"
    first = payload()
    first["test_device"]["temperature_c"] = 70
    store.update(topic, first, received_monotonic=100)
    stale = store.list(now_monotonic=115)[0]
    assert stale["test_device"]["connection_status"] == "unknown"
    assert stale["alarms"] == []
    assert stale["last_alarms"]
    restored = payload(2)
    restored["observed_at"] = "2026-09-16T14:30:25+08:00"
    assert store.update(topic, restored, received_monotonic=120)["connection_status"] == "recovering"
    assert store.update(topic, restored, received_monotonic=121)["connection_status"] == "recovering"
    restored["sequence"] = 3
    restored["observed_at"] = "2026-09-16T14:30:26+08:00"
    row = store.update(topic, restored, received_monotonic=122)
    assert row["connection_status"] == "online"
    assert row["last_alarms"] == []


def test_host_heartbeat_cannot_refresh_a_frozen_device_sample():
    store = LaboratoryTelemetryStore()
    topic = "mes/v1/labs/LAB_HOT_HUMID_2/telemetry/snapshot"
    for index in range(17):
        sample = payload(index + 1)
        sample["observed_at"] = f"2026-09-16T14:30:{index:02d}+08:00"
        sample["test_device"]["observed_at"] = "2026-09-16T14:30:00+08:00"
        row = store.update(topic, sample, received_monotonic=100 + index)
    assert row["connection_status"] == "online"
    assert row["environment"]["connection_status"] == "online"
    assert row["test_device"]["connection_status"] == "offline"


def test_absent_device_metadata_is_unknown_not_online():
    store = LaboratoryTelemetryStore()
    sample = payload()
    sample.pop("test_device")
    row = store.update("mes/v1/labs/LAB_HOT_HUMID_2/telemetry/snapshot", sample, received_monotonic=100)
    assert row["test_device"]["connection_status"] == "unknown"
