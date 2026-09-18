from __future__ import annotations

import copy
import math
import threading
import time
from datetime import datetime
from typing import Any
from app.core.config import settings


TELEMETRY_DELAYED_AFTER_SECONDS = 5
TELEMETRY_OFFLINE_AFTER_SECONDS = 15
TEMPERATURE_HIGH_C = 60.0
VOLTAGE_LOW_V = 100.0


def _text(value: Any) -> str:
    return str(value or "").strip()


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
        return round(number, 2) if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def _device(value: Any, *, configured_default: bool = True) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    configured = bool(source.get("configured", configured_default))
    return {
        "configured": configured,
        "online": source.get("online") is True if configured else False,
        "observed_at": _text(source.get("observed_at")),
        "reported": isinstance(value, dict),
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
        if not device.get("configured") or not device.get("online"):
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

    def __init__(self, *, delayed_after: float = 5, offline_after: float = 15) -> None:
        if not 0 < delayed_after < offline_after:
            raise ValueError("telemetry thresholds must satisfy 0 < delayed < offline")
        self.delayed_after = delayed_after
        self.offline_after = offline_after
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
            gap = now_mono - current["_received_monotonic"] if current else 0
            normalized["_recovery"] = (1 if gap >= self.delayed_after else min(2, current.get("_recovery", 2) + 1)) if current else 2
            for key in ("environment", "test_device", "carrier_device"):
                group = normalized[key]
                previous = current.get(key, {}) if current else {}
                is_environment = key == "environment"
                valid = (group.get("quality") == "good" if is_environment else group.get("online") is True)
                sample_time = _text((payload.get(key) or {}).get("observed_at")) or normalized["observed_at"]
                fresh = valid and (not sample_time or sample_time != previous.get("_sample_time"))
                group["_sample_time"] = sample_time
                group["_last_mono"] = now_mono if fresh else previous.get("_last_mono")
                group["last_valid_at"] = (sample_time or normalized["received_at"]) if fresh else previous.get("last_valid_at", "")
                group["last_values"] = {k: group.get(k) for k in ("temperature_c", "humidity_rh", "voltage_v")} if fresh else copy.deepcopy(previous.get("last_values", {}))
                was_stale = previous and (previous.get("_last_mono") is None or now_mono - previous["_last_mono"] >= self.delayed_after or previous.get("online") is False)
                group["_recovery"] = (1 if was_stale else min(2, previous.get("_recovery", 2) + 1)) if fresh else (previous.get("_recovery", 0) if valid else 0)
                group["_lost_since"] = ((previous.get("_lost_since") if previous.get("_lost_since") is not None else now_mono) if not valid else None)
            normalized["_previous_alarms"] = []
            if current:
                for alarm in current.get("alarms", []) or current.get("_previous_alarms", []):
                    key = alarm["metric"].split(".")[0]
                    group = normalized[key]
                    if normalized["_recovery"] < 2 or group["_recovery"] < 2 or not group.get("online"):
                        normalized["_previous_alarms"].append(alarm)
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

    def _public_snapshot(self, snapshot: dict[str, Any], now_mono: float) -> dict[str, Any]:
        result = copy.deepcopy(snapshot)
        received_mono = float(result.pop("_received_monotonic", now_mono))
        age_seconds = max(0, int(now_mono - received_mono))
        if age_seconds >= self.offline_after:
            connection_status = "offline"
        elif age_seconds >= self.delayed_after:
            connection_status = "delayed"
        elif result.pop("_recovery", 2) < 2:
            connection_status = "recovering"
        else:
            connection_status = "online"
        result["age_seconds"] = age_seconds
        result["connection_status"] = connection_status
        pending_alarms = result.pop("_previous_alarms", [])
        for key in ("environment", "test_device", "carrier_device"):
            group = result[key]
            last = group.pop("_last_mono", None)
            group_age = max(0, int(now_mono - last)) if last is not None else None
            recovery = group.pop("_recovery", 0)
            lost_since = group.pop("_lost_since", None)
            group.pop("_sample_time", None)
            configured = group.get("configured", True)
            reported_online = group.get("quality") == "good" if key == "environment" else group.get("online") is True
            if not configured:
                state = "not_configured"
            elif connection_status == "offline":
                state = "unknown"
            elif not reported_online:
                state = "offline" if group.get("reported", key == "environment") else "unknown"
            elif group_age is None:
                state = "unknown"
            elif group_age >= self.offline_after:
                state = "offline"
            elif group_age >= self.delayed_after or connection_status == "delayed":
                state = "delayed"
            elif recovery < 2 or connection_status == "recovering":
                state = "recovering"
            else:
                state = "online"
            group["connection_status"] = state
            group["age_seconds"] = group_age
            group["lost_seconds"] = max(0, int(now_mono - lost_since)) if lost_since is not None else group_age
        live_alarms = [alarm for alarm in result["alarms"] if connection_status == "online" and result[alarm["metric"].split(".")[0]]["connection_status"] == "online"]
        result["last_alarms"] = (result["alarms"] or pending_alarms) if connection_status != "online" or any(result[key]["connection_status"] not in {"online", "not_configured"} for key in ("test_device", "carrier_device")) else []
        result["alarms"] = live_alarms
        result["has_alarm"] = bool(live_alarms)
        result.pop("_recovery", None)
        return result


laboratory_telemetry_store = LaboratoryTelemetryStore(
    delayed_after=settings.TELEMETRY_DELAYED_AFTER_SECONDS,
    offline_after=settings.TELEMETRY_OFFLINE_AFTER_SECONDS,
)


def process_laboratory_telemetry(topic: str, payload: dict[str, Any]) -> dict[str, Any]:
    return laboratory_telemetry_store.update(topic, payload)
