from __future__ import annotations

import copy
import threading
import time
from datetime import datetime
from typing import Any


TELEMETRY_DELAYED_AFTER_SECONDS = 15
TELEMETRY_OFFLINE_AFTER_SECONDS = 30
TEMPERATURE_HIGH_C = 60.0
VOLTAGE_LOW_V = 100.0


def _text(value: Any) -> str:
    return str(value or "").strip()


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None


def _device(value: Any, *, configured_default: bool = True) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    configured = bool(source.get("configured", configured_default))
    return {
        "configured": configured,
        "online": bool(source.get("online", configured)) if configured else False,
        "temperature_c": _number(source.get("temperature_c")) if configured else None,
        "voltage_v": _number(source.get("voltage_v")) if configured else None,
        "alarm_code": _text(source.get("alarm_code")) or None,
    }


def _build_alarms(test_device: dict[str, Any], carrier_device: dict[str, Any]) -> list[dict[str, Any]]:
    alarms: list[dict[str, Any]] = []
    checks = (
        ("试验设备", "test_device", test_device),
        ("搬运设备", "carrier_device", carrier_device),
    )
    for label, metric_prefix, device in checks:
        if not device.get("configured"):
            continue
        temperature = device.get("temperature_c")
        voltage = device.get("voltage_v")
        if temperature is not None and temperature > TEMPERATURE_HIGH_C:
            alarms.append({
                "code": f"{metric_prefix.upper()}_TEMPERATURE_HIGH",
                "severity": "critical",
                "metric": f"{metric_prefix}.temperature_c",
                "value": temperature,
                "threshold": TEMPERATURE_HIGH_C,
                "message": f"{label}温度过高：{temperature:.1f} °C",
            })
        if voltage is not None and voltage < VOLTAGE_LOW_V:
            alarms.append({
                "code": f"{metric_prefix.upper()}_VOLTAGE_LOW",
                "severity": "critical",
                "metric": f"{metric_prefix}.voltage_v",
                "value": voltage,
                "threshold": VOLTAGE_LOW_V,
                "message": f"{label}电压过低：{voltage:.1f} V",
            })
    return alarms


class LaboratoryTelemetryStore:
    """Thread-safe latest-value store fed only by upper-computer MQTT telemetry."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._snapshots: dict[str, dict[str, Any]] = {}

    def update(self, topic: str, payload: dict[str, Any], *, received_monotonic: float | None = None) -> dict[str, Any]:
        topic_lab_code = self._lab_code_from_topic(topic)
        payload_lab_code = _text(payload.get("lab_code"))
        if topic_lab_code and payload_lab_code and topic_lab_code != payload_lab_code:
            raise ValueError("telemetry topic and payload lab_code do not match")
        lab_code = topic_lab_code or payload_lab_code
        if not lab_code:
            raise ValueError("telemetry payload requires lab_code")
        environment = payload.get("environment") if isinstance(payload.get("environment"), dict) else {}
        message_id = _text(payload.get("message_id"))
        boot_id = _text(payload.get("boot_id"))
        sequence = payload.get("sequence")
        try:
            sequence = int(sequence)
        except (TypeError, ValueError):
            sequence = 0

        now_mono = time.monotonic() if received_monotonic is None else received_monotonic
        test_device = _device(payload.get("test_device"))
        carrier_device = _device(payload.get("carrier_device"))
        alarms = _build_alarms(test_device, carrier_device)
        normalized = {
            "schema_version": _text(payload.get("schema_version")) or "1.0",
            "message_id": message_id,
            "source_id": _text(payload.get("source_id")),
            "boot_id": boot_id,
            "sequence": sequence,
            "lab_code": lab_code,
            "observed_at": _text(payload.get("observed_at")),
            "collector_status": _text(payload.get("collector_status")) or "online",
            "environment": {
                "temperature_c": _number(environment.get("temperature_c")),
                "humidity_rh": _number(environment.get("humidity_rh")),
                "quality": _text(environment.get("quality")) or "unknown",
            },
            "test_device": test_device,
            "carrier_device": carrier_device,
            "alarms": alarms,
            "has_alarm": bool(alarms),
            "received_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "_received_monotonic": now_mono,
        }
        with self._lock:
            current = self._snapshots.get(lab_code)
            if current and boot_id and boot_id == current.get("boot_id") and sequence <= int(current.get("sequence") or 0):
                return self._public_snapshot(current, now_mono)
            self._snapshots[lab_code] = normalized
            return self._public_snapshot(normalized, now_mono)

    def list(self, *, now_monotonic: float | None = None) -> list[dict[str, Any]]:
        now_mono = time.monotonic() if now_monotonic is None else now_monotonic
        with self._lock:
            return [self._public_snapshot(item, now_mono) for item in self._snapshots.values()]

    def clear(self) -> None:
        with self._lock:
            self._snapshots.clear()

    @staticmethod
    def _lab_code_from_topic(topic: str) -> str:
        parts = [part for part in _text(topic).strip("/").split("/") if part]
        try:
            index = parts.index("labs")
        except ValueError:
            return ""
        return parts[index + 1] if len(parts) > index + 1 else ""

    @staticmethod
    def _public_snapshot(snapshot: dict[str, Any], now_mono: float) -> dict[str, Any]:
        result = copy.deepcopy(snapshot)
        received_mono = float(result.pop("_received_monotonic", now_mono))
        age_seconds = max(0, int(now_mono - received_mono))
        if age_seconds >= TELEMETRY_OFFLINE_AFTER_SECONDS:
            connection_status = "offline"
        elif age_seconds >= TELEMETRY_DELAYED_AFTER_SECONDS:
            connection_status = "delayed"
        else:
            connection_status = "online"
        result["age_seconds"] = age_seconds
        result["connection_status"] = connection_status
        return result


laboratory_telemetry_store = LaboratoryTelemetryStore()


def process_laboratory_telemetry(topic: str, payload: dict[str, Any]) -> dict[str, Any]:
    return laboratory_telemetry_store.update(topic, payload)
