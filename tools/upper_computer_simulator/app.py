from __future__ import annotations

import json
import math
import os
import random
import threading
import uuid
from collections import deque
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import AliasChoices, BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent
BEIJING_TZ = timezone(timedelta(hours=8))
MAX_LOGS = 500
SIMULATOR_VERSION = "2.8"
AUTO_REPLY_DELAY_SECONDS = 0.1
TELEMETRY_INTERVAL_SECONDS = 1
FAULT_EVERY_CYCLES = 10
FAULT_HOLD_CYCLES = 3
TEMPERATURE_HIGH_C = 60.0
VOLTAGE_LOW_V = 100.0
MES_ONLY_COMMAND_FIELDS = frozenset({
    "schedule_id", "scheduleId", "schedule_no", "scheduleNo",
    "schedule_snapshot", "scheduleSnapshot",
})
LABORATORIES = (
    ("LAB_IMPACT_1", "冲击一室", True),
    ("LAB_IMPACT_2", "冲击二室", True),
    ("LAB_VIBRATION_1", "振动一室", True),
    ("LAB_VIBRATION_2", "振动二室", True),
    ("LAB_COMPREHENSIVE", "四综合实验室", True),
    ("LAB_TEMP_SHOCK_1", "温度冲击一室", True),
    ("LAB_TEMP_SHOCK_2", "温度冲击二室", True),
    ("LAB_HOT_HUMID", "高低温湿热一室", True),
    ("LAB_HOT_HUMID_2", "高低温湿热二室", False),
    ("LAB_SALT", "盐雾试验室", True),
    ("LAB_MOLD", "霉菌试验室", True),
)


def beijing_now_text() -> str:
    return datetime.now(BEIJING_TZ).strftime("%Y-%m-%d %H:%M:%S")


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def without_schedule_context(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if key not in MES_ONLY_COMMAND_FIELDS}


def normalize_prefix(value: str) -> str:
    return normalize_text(value).strip("/") or "mes/v1"


def mqtt_reason_code_value(reason_code: Any) -> int | None:
    value = getattr(reason_code, "value", None)
    if value is not None:
        try:
            return int(value)
        except (TypeError, ValueError):
            return None
    try:
        return int(reason_code)
    except (TypeError, ValueError):
        return 0 if str(reason_code).lower() == "success" else None


class MqttConfig(BaseModel):
    host: str = Field(default="127.0.0.1", min_length=1)
    port: int = Field(default=1883, ge=1, le=65535)
    topicPrefix: str = "mes/v1"
    lab_code: str = Field(default="LAB_SALT", min_length=1)
    username: str = "guest"
    password: str = "guest"
    auto_mode: bool = False


class FixtureReadyRequest(BaseModel):
    success_id: str = Field(default="OK", min_length=1)
    event_time: str = ""


class EventRequest(BaseModel):
    event_time: str = ""
    run_no: str = Field(default="", validation_alias=AliasChoices("run_no", "runNo"))
    axis_codes: list[str] = Field(default_factory=list, validation_alias=AliasChoices("axis_codes", "axisCodes"))
    axis_batch_no: str = Field(default="", validation_alias=AliasChoices("axis_batch_no", "axisBatchNo"))
    current_axis_code: str = Field(default="", validation_alias=AliasChoices("current_axis_code", "currentAxisCode", "axis_code", "axisCode"))
    result_package: dict[str, Any] | None = None


class TelemetryUpdateRequest(BaseModel):
    lab_code: str = Field(min_length=1)
    enabled: bool | None = None
    room_temperature_c: float | None = None
    humidity_rh: float | None = Field(default=None, ge=0, le=100)
    test_temperature_c: float | None = None
    test_voltage_v: float | None = Field(default=None, ge=0)
    carrier_temperature_c: float | None = None
    carrier_voltage_v: float | None = Field(default=None, ge=0)


class MqttSimulator:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._connect_lock = threading.RLock()
        self._logs: deque[dict[str, Any]] = deque(maxlen=MAX_LOGS)
        self._client: Any | None = None
        self._config = MqttConfig()
        self._connected = False
        self._connect_event: threading.Event | None = None
        self._last_messages: dict[str, dict[str, Any]] = {}
        self._lab_contexts: dict[str, dict[str, Any]] = {}
        self._ending_runs: set[tuple[str, str, str, str]] = set()
        self._ended_runs: set[tuple[str, str, str, str]] = set()
        self._telemetry_stop = threading.Event()
        self._telemetry_thread: threading.Thread | None = None
        self._telemetry_boot_id = uuid.uuid4().hex
        self._telemetry_sequences: dict[str, int] = {}
        self._telemetry_overrides: dict[str, dict[str, Any]] = {
            code: {"enabled": True} for code, _name, _carrier in LABORATORIES
        }
        self._last_telemetry: dict[str, dict[str, Any]] = {}
        self._telemetry_cycle = 0
        self._active_fault: dict[str, Any] | None = None
        self._telemetry_faults: dict[str, dict[str, Any]] = {}
        self._telemetry_publish_lock = threading.RLock()

    def log(self, level: str, message: str, payload: Any | None = None, topic: str = "") -> None:
        entry = {
            "time": beijing_now_text(),
            "level": level,
            "message": message,
            "topic": topic,
            "payload": payload,
        }
        with self._lock:
            self._logs.appendleft(entry)

    def state(self) -> dict[str, Any]:
        with self._lock:
            return {
                "version": SIMULATOR_VERSION,
                "connected": self._connected,
                "config": self._config.model_dump(exclude={"password"}),
                "lastMessages": self._last_messages,
                "telemetry": self.telemetry_state(),
                "telemetryMeta": self.telemetry_meta(),
            }

    def logs(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._logs)

    def connect(self, config: MqttConfig) -> dict[str, Any]:
        with self._connect_lock:
            return self._connect_locked(config)

    def _connect_locked(self, config: MqttConfig) -> dict[str, Any]:
        try:
            import paho.mqtt.client as mqtt
        except ImportError as exc:
            raise HTTPException(status_code=500, detail="缺少 paho-mqtt，请先运行 pip install -r requirements.txt") from exc

        if config.username == "guest" and not config.password:
            config = config.model_copy(update={"password": "guest"})
        with self._lock:
            if self._connected and self._client is not None and self._config == config:
                return self.state()
        self._disconnect_locked(silent=True)
        connect_event = threading.Event()
        client_id = f"mes-upper-simulator-{os.getpid()}-{uuid.uuid4().hex[:8]}"
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)
        if config.username:
            client.username_pw_set(config.username, config.password)
        client.on_connect = self._on_connect
        client.on_disconnect = self._on_disconnect
        client.on_message = self._on_message
        client.reconnect_delay_set(min_delay=1, max_delay=10)

        with self._lock:
            self._client = client
            self._config = config
            self._connect_event = connect_event
            self._last_messages = {}
            self._lab_contexts = {}
            self._ending_runs.clear()
            self._ended_runs.clear()
            self._telemetry_stop.set()

        try:
            client.connect(config.host, config.port, keepalive=60)
            client.loop_start()
        except Exception as exc:
            with self._lock:
                self._client = None
                self._connected = False
            self.log("error", f"连接 MQTT 失败：{exc}")
            raise HTTPException(status_code=503, detail=f"连接 MQTT 失败：{exc}") from exc

        self.log("info", f"正在连接 MQTT：{config.host}:{config.port}")
        connect_event.wait(timeout=3)
        return self.state()

    def disconnect(self, silent: bool = False) -> dict[str, Any]:
        with self._connect_lock:
            return self._disconnect_locked(silent=silent)

    def _disconnect_locked(self, silent: bool = False) -> dict[str, Any]:
        with self._lock:
            client = self._client
            self._client = None
            self._connected = False
            self._ending_runs.clear()
            self._ended_runs.clear()
            self._telemetry_stop.set()
            self._telemetry_thread = None
        if client is not None:
            try:
                client.disconnect()
                client.loop_stop()
            except Exception as exc:
                if not silent:
                    self.log("warning", f"断开 MQTT 时出现异常：{exc}")
        if not silent:
            self.log("info", "已断开 MQTT")
        return self.state()

    def _on_connect(self, client: Any, _userdata: Any, _flags: Any, reason_code: Any, _properties: Any) -> None:
        reason_value = mqtt_reason_code_value(reason_code)
        success = reason_value == 0
        with self._lock:
            self._connected = success
            config = self._config
            connect_event = self._connect_event
        if not success:
            self.log("error", f"MQTT 连接被拒绝：{reason_code}")
            if connect_event is not None:
                connect_event.set()
            return
        prefix = normalize_prefix(config.topicPrefix)
        command_topic = f"{prefix}/labs/+/commands/#" if config.auto_mode else f"{prefix}/labs/{config.lab_code}/commands/#"
        client.subscribe(command_topic)
        self._start_telemetry_publisher()
        self.log("success", f"MQTT 已连接，已订阅 {command_topic}")
        if connect_event is not None:
            connect_event.set()

    def _on_disconnect(self, _client: Any, _userdata: Any, _flags: Any, reason_code: Any, _properties: Any) -> None:
        with self._lock:
            self._connected = False
            connect_event = self._connect_event
        if connect_event is not None:
            connect_event.set()
        self.log("warning", f"MQTT 已断开：{reason_code}")

    def _start_telemetry_publisher(self) -> None:
        with self._lock:
            if self._telemetry_thread is not None and self._telemetry_thread.is_alive():
                return
            stop_event = threading.Event()
            self._telemetry_stop = stop_event
            thread = threading.Thread(target=self._telemetry_loop, args=(stop_event,), name="upper-computer-telemetry", daemon=True)
            self._telemetry_thread = thread
        thread.start()

    def _telemetry_loop(self, stop_event: threading.Event) -> None:
        while not stop_event.is_set():
            try:
                self.publish_all_telemetry(advance_cycle=True)
            except Exception as exc:
                self.log("error", f"遥测发送失败，将在下一轮重试：{exc}")
            stop_event.wait(TELEMETRY_INTERVAL_SECONDS)

    def _new_random_fault(self, enabled_lab_codes: list[str]) -> dict[str, Any] | None:
        if not enabled_lab_codes:
            return None
        lab_code = random.choice(enabled_lab_codes)
        candidates = ["temperature_high", "voltage_low", "test_device_offline", "host_offline", "telemetry_delayed"]
        if lab_code != "LAB_HOT_HUMID_2":
            candidates.append("carrier_device_offline")
        fault_type = random.choice(candidates)
        duration = FAULT_HOLD_CYCLES
        if fault_type == "temperature_high":
            value = round(random.uniform(64.0, 78.0), 1)
            message = f"试验设备温度过高：{value:.1f} °C（上限 {TEMPERATURE_HIGH_C:.0f} °C）"
        elif fault_type == "voltage_low":
            value = round(random.uniform(68.0, 95.0), 1)
            message = f"试验设备电压过低：{value:.1f} V（下限 {VOLTAGE_LOW_V:.0f} V）"
        else:
            value = None
            message, duration = {
                "test_device_offline": ("试验设备失联", 6),
                "carrier_device_offline": ("搬运设备失联", 6),
                "host_offline": ("上位机失联：暂停该试验间遥测 20 秒", 20),
                "telemetry_delayed": ("数据延迟：暂停该试验间遥测 7 秒", 7),
            }[fault_type]
        return {
            "lab_code": lab_code,
            "fault_type": fault_type,
            "value": value,
            "message": message,
            "remaining_cycles": duration,
        }

    @staticmethod
    def _build_alarms(test_temperature: float, test_voltage: float) -> list[dict[str, Any]]:
        alarms: list[dict[str, Any]] = []
        if test_temperature > TEMPERATURE_HIGH_C:
            alarms.append({
                "code": "TEST_DEVICE_TEMPERATURE_HIGH",
                "severity": "critical",
                "metric": "test_device.temperature_c",
                "value": test_temperature,
                "threshold": TEMPERATURE_HIGH_C,
                "message": f"试验设备温度过高：{test_temperature:.1f} °C",
            })
        if test_voltage < VOLTAGE_LOW_V:
            alarms.append({
                "code": "TEST_DEVICE_VOLTAGE_LOW",
                "severity": "critical",
                "metric": "test_device.voltage_v",
                "value": test_voltage,
                "threshold": VOLTAGE_LOW_V,
                "message": f"试验设备电压过低：{test_voltage:.1f} V",
            })
        return alarms

    def publish_all_telemetry(self, *, advance_cycle: bool = True) -> None:
        with self._telemetry_publish_lock:
            self._publish_all_telemetry(advance_cycle=advance_cycle)

    def _publish_all_telemetry(self, *, advance_cycle: bool) -> None:
        with self._lock:
            client = self._client
            config = self._config
            connected = self._connected
            if client is None or not connected:
                return
            overrides = {key: dict(value) for key, value in self._telemetry_overrides.items()}
            if advance_cycle:
                self._telemetry_cycle += 1
                if self._telemetry_cycle % FAULT_EVERY_CYCLES == 0:
                    enabled_codes = [code for code, _name, _carrier in LABORATORIES if overrides.get(code, {}).get("enabled", True) and code not in self._telemetry_faults]
                    self._active_fault = self._new_random_fault(enabled_codes)
                    if self._active_fault:
                        self._telemetry_faults[self._active_fault["lab_code"]] = self._active_fault
                        self.log("warning", f"已注入遥测故障：{self._active_fault['message']}", self._active_fault)
            faults = {key: dict(value) for key, value in self._telemetry_faults.items()}
        if client is None or not connected:
            return
        prefix = normalize_prefix(config.topicPrefix)
        tick = datetime.now(BEIJING_TZ).timestamp() / TELEMETRY_INTERVAL_SECONDS
        for index, (lab_code, lab_name, carrier_configured) in enumerate(LABORATORIES):
            active_fault = faults.get(lab_code)
            fault_type = active_fault.get("fault_type") if active_fault else None
            if fault_type in {"host_offline", "telemetry_delayed"}:
                continue
            lab_override = overrides.get(lab_code, {})
            if not lab_override.get("enabled", True):
                continue
            with self._lock:
                sequence = self._telemetry_sequences.get(lab_code, 0) + 1
                self._telemetry_sequences[lab_code] = sequence
            wave = math.sin(tick + index * 0.71)
            room_temperature = round(float(lab_override.get("room_temperature_c", 22.4 + index * 0.12)) + wave * 0.25, 1)
            humidity = round(max(0.0, min(100.0, float(lab_override.get("humidity_rh", 46 + (index % 5) * 2.3)) + wave * 1.2)), 1)
            test_temperature = round(float(lab_override.get("test_temperature_c", 31 + index * 1.7)) + wave * 1.8, 1)
            test_voltage = round(max(0.0, float(lab_override.get("test_voltage_v", 220)) + wave * 1.4), 1)
            if active_fault and active_fault.get("lab_code") == lab_code:
                if active_fault.get("fault_type") == "temperature_high":
                    test_temperature = float(active_fault["value"])
                elif active_fault.get("fault_type") == "voltage_low":
                    test_voltage = float(active_fault["value"])
            alarms = self._build_alarms(test_temperature, test_voltage)
            payload = {
                "schema_version": "1.0",
                "message_id": str(uuid.uuid4()),
                "source_id": f"upper-{lab_code}",
                "boot_id": self._telemetry_boot_id,
                "sequence": sequence,
                "lab_code": lab_code,
                "lab_name": lab_name,
                "observed_at": datetime.now(BEIJING_TZ).isoformat(timespec="seconds"),
                "collector_status": "online",
                "cycle": self._telemetry_cycle,
                "alarms": alarms,
                "environment": {
                    "temperature_c": room_temperature,
                    "humidity_rh": humidity,
                    "quality": "good",
                },
                "test_device": {
                    "configured": True,
                    "online": True,
                    "temperature_c": test_temperature,
                    "voltage_v": test_voltage,
                    "alarm_code": alarms[0]["code"] if alarms else None,
                },
                "carrier_device": {
                    "configured": carrier_configured,
                    "online": carrier_configured,
                    "temperature_c": lab_override.get("carrier_temperature_c", round(28 + index * 0.35 + wave, 1)) if carrier_configured else None,
                    "voltage_v": lab_override.get("carrier_voltage_v", round(222 + wave * 1.1, 1)) if carrier_configured else None,
                    "alarm_code": None,
                },
            }
            for key in ("test_device", "carrier_device"):
                device = payload[key]
                if not device["configured"]:
                    continue
                device["observed_at"] = payload["observed_at"]
                if fault_type == f"{key}_offline":
                    previous = self._last_telemetry.get(lab_code, {}).get(key, {})
                    device.update(online=False, temperature_c=None, voltage_v=None,
                                  observed_at=previous.get("observed_at", ""), alarm_code=None)
                    if key == "test_device":
                        payload["alarms"] = []
            topic = f"{prefix}/labs/{lab_code}/telemetry/snapshot"
            result = client.publish(topic, json.dumps(payload, ensure_ascii=False, separators=(",", ":")), qos=1, retain=False)
            if getattr(result, "rc", 1) == 0:
                with self._lock:
                    self._last_telemetry[lab_code] = payload
        if advance_cycle:
            with self._lock:
                for lab_code, fault in list(self._telemetry_faults.items()):
                    fault["remaining_cycles"] -= 1
                    if fault["remaining_cycles"] <= 0:
                        self.log("info", "遥测故障注入已自动恢复", fault)
                        del self._telemetry_faults[lab_code]
                        if self._active_fault is fault:
                            self._active_fault = None

    def telemetry_state(self) -> list[dict[str, Any]]:
        with self._lock:
            overrides = {key: dict(value) for key, value in self._telemetry_overrides.items()}
            latest = {key: dict(value) for key, value in self._last_telemetry.items()}
        rows = []
        for lab_code, lab_name, carrier_configured in LABORATORIES:
            payload = latest.get(lab_code, {})
            rows.append({
                "lab_code": lab_code,
                "lab_name": lab_name,
                "enabled": overrides.get(lab_code, {}).get("enabled", True),
                "carrier_configured": carrier_configured,
                "payload": payload,
            })
        return rows

    def telemetry_meta(self) -> dict[str, Any]:
        with self._lock:
            cycle = self._telemetry_cycle
            active_fault = dict(self._active_fault) if self._active_fault else None
            active_faults = [dict(fault) for fault in self._telemetry_faults.values()]
        return {
            "interval_seconds": TELEMETRY_INTERVAL_SECONDS,
            "cycle": cycle,
            "cycle_in_fault_window": cycle % FAULT_EVERY_CYCLES,
            "next_fault_in_cycles": FAULT_EVERY_CYCLES - (cycle % FAULT_EVERY_CYCLES),
            "fault_every_cycles": FAULT_EVERY_CYCLES,
            "active_fault": active_fault,
            "active_faults": active_faults,
        }

    def update_telemetry(self, request: TelemetryUpdateRequest) -> dict[str, Any]:
        known_codes = {code for code, _name, _carrier in LABORATORIES}
        if request.lab_code not in known_codes:
            raise HTTPException(status_code=404, detail="未知试验间")
        updates = request.model_dump(exclude={"lab_code"}, exclude_none=True)
        with self._lock:
            self._telemetry_overrides.setdefault(request.lab_code, {"enabled": True}).update(updates)
        self.publish_all_telemetry(advance_cycle=False)
        return {"ok": True, **self.telemetry_meta(), "items": self.telemetry_state()}

    def _on_message(self, _client: Any, _userdata: Any, msg: Any) -> None:
        text = msg.payload.decode("utf-8", errors="replace")
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            payload = {"raw": text}
        if isinstance(payload, dict):
            payload = without_schedule_context(payload)
        topic = str(msg.topic)
        command = topic.rstrip("/").split("/")[-1]
        with self._lock:
            self._last_messages[command] = {
                "time": beijing_now_text(),
                "topic": topic,
                "payload": payload,
            }
            if isinstance(payload, dict):
                lab_code = self._resolve_message_lab_code(topic, payload)
                if lab_code:
                    context = self._lab_contexts.setdefault(lab_code, {})
                    for source_key, target_key in (
                        ("task_code", "task_code"),
                        ("taskCode", "task_code"),
                        ("experiment_code", "experiment_code"),
                        ("experimentCode", "experiment_code"),
                        ("run_no", "run_no"),
                        ("runNo", "run_no"),
                        ("axis_batch_no", "axis_batch_no"),
                        ("axisBatchNo", "axis_batch_no"),
                        ("current_axis_code", "current_axis_code"),
                        ("currentAxisCode", "current_axis_code"),
                        ("axis_code", "current_axis_code"),
                        ("axisCode", "current_axis_code"),
                        ("fixture_install_id", "fixture_install_id"),
                        ("fixtureInstallId", "fixture_install_id"),
                        ("sub_experiment_code", "sub_experiment_code"),
                        ("subExperimentCode", "sub_experiment_code"),
                        ("next_axis_code", "next_axis_code"),
                        ("nextAxisCode", "next_axis_code"),
                    ):
                        value = normalize_text(payload.get(source_key))
                        if value:
                            context[target_key] = value
                    axis_codes = payload.get("axis_codes")
                    if axis_codes is None:
                        axis_codes = payload.get("axisCodes")
                    if isinstance(axis_codes, str):
                        axis_codes = [item.strip() for item in axis_codes.replace("，", ",").split(",")]
                    if isinstance(axis_codes, list):
                        normalized_axis_codes = []
                        for item in axis_codes:
                            axis_code = normalize_text(item)
                            if axis_code and axis_code not in normalized_axis_codes:
                                normalized_axis_codes.append(axis_code)
                        if normalized_axis_codes:
                            context["axis_codes"] = normalized_axis_codes
                    tray_codes = payload.get("tray_codes")
                    if tray_codes is None:
                        tray_codes = payload.get("trayCodes")
                    if isinstance(tray_codes, str):
                        tray_codes = [item.strip() for item in tray_codes.replace("，", ",").split(",")]
                    if isinstance(tray_codes, list):
                        normalized_tray_codes = []
                        for item in tray_codes:
                            tray_code = normalize_text(item)
                            if tray_code and tray_code not in normalized_tray_codes:
                                normalized_tray_codes.append(tray_code)
                        if normalized_tray_codes:
                            context["tray_codes"] = normalized_tray_codes
                    if command == "experiment-ready":
                        # The previous axis' next_axis_code has now become the
                        # current axis. Do not echo that stale transition field
                        # in experiment-started or later events.
                        context.pop("next_axis_code", None)
        self.log("receive", f"收到 MES 命令：{command}", payload, topic)
        self._maybe_auto_reply(command, topic, payload)

    def _lab_code_from_topic(self, topic: str) -> str:
        parts = [part for part in normalize_text(topic).strip("/").split("/") if part]
        try:
            labs_index = parts.index("labs")
        except ValueError:
            return ""
        if len(parts) <= labs_index + 2 or parts[labs_index + 2] != "commands":
            return ""
        return normalize_text(parts[labs_index + 1])

    def _resolve_message_lab_code(self, topic: str, payload: Any) -> str:
        topic_lab_code = self._lab_code_from_topic(topic)
        if topic_lab_code:
            return topic_lab_code
        if isinstance(payload, dict):
            payload_lab_code = normalize_text(payload.get("lab_code"))
            if payload_lab_code:
                return payload_lab_code
        return self.current_lab_code()

    def _run_key(self, lab_code: str, run_no: str) -> tuple[str, str]:
        return normalize_text(lab_code), normalize_text(run_no)

    def _completion_key(self, lab_code: str, context: dict[str, Any]) -> tuple[str, str, str, str]:
        axis_code = normalize_text(context.get("axis_code") or context.get("current_axis_code"))
        return (
            normalize_text(lab_code),
            normalize_text(context.get("run_no")),
            normalize_text(context.get("sub_experiment_code")),
            axis_code or "__FULL__",
        )

    def _experiment_end_payload(self, lab_code: str, context: dict[str, Any]) -> dict[str, Any]:
        payload = {
            "lab_code": normalize_text(lab_code),
            **context,
            "ended_at": normalize_text(context.get("ended_at")) or beijing_now_text(),
        }
        axis_code = normalize_text(context.get("axis_code") or context.get("current_axis_code"))
        if axis_code:
            payload["axis_code"] = axis_code
        next_axis_code = normalize_text(context.get("next_axis_code"))
        axis_codes = context.get("axis_codes") if isinstance(context.get("axis_codes"), list) else []
        if not next_axis_code and axis_code in axis_codes:
            axis_index = axis_codes.index(axis_code)
            if axis_index + 1 < len(axis_codes):
                next_axis_code = normalize_text(axis_codes[axis_index + 1])
        if next_axis_code:
            payload["next_axis_code"] = next_axis_code
        return payload

    def _publish_experiment_end_once(self, lab_code: str, context: dict[str, Any]) -> dict[str, Any]:
        run_no = normalize_text(context.get("run_no"))
        run_key = self._run_key(lab_code, run_no)
        completion_key = self._completion_key(lab_code, context)
        if not all(run_key):
            self.log("error", "无法回传 experiment-ended：缺少 lab_code 或 run_no", context)
            return {"ok": False, "reason": "missing_run_context"}
        with self._lock:
            if completion_key in self._ended_runs or completion_key in self._ending_runs:
                self.log(
                    "info",
                    "已忽略重复 experiment-ended",
                    {
                        "lab_code": completion_key[0],
                        "run_no": completion_key[1],
                        "sub_experiment_code": completion_key[2],
                        "axis_code": "" if completion_key[3] == "__FULL__" else completion_key[3],
                    },
                )
                return {"ok": True, "duplicate": True}
            self._ending_runs.add(completion_key)
        payload = self._experiment_end_payload(lab_code, context)
        try:
            result = self.publish("experiment-ended", payload, lab_code=lab_code)
            if result.get("ok"):
                with self._lock:
                    self._ended_runs.add(completion_key)
            return result
        finally:
            with self._lock:
                self._ending_runs.discard(completion_key)

    def _schedule_immediate_experiment_end(self, lab_code: str, payload: Any) -> None:
        request_payload = payload if isinstance(payload, dict) else {}
        context = self._context_payload(lab_code, normalize_text(request_payload.get("run_no")), request_payload)
        for key in ("axis_code", "current_axis_code", "next_axis_code", "sub_experiment_code"):
            context.pop(key, None)
        for key in ("axis_code", "next_axis_code", "sub_experiment_code"):
            value = normalize_text(request_payload.get(key))
            if value:
                context[key] = value
        timer = threading.Timer(0, lambda: self._publish_experiment_end_once(lab_code, context))
        timer.daemon = True
        timer.start()
        self.log("info", "已收到立即结束请求", {"lab_code": lab_code, "run_no": context.get("run_no", "")})

    def _schedule_auto_publish(
        self,
        event_name: str,
        lab_code: str,
        payload_factory: Any,
    ) -> None:
        def publish_later() -> None:
            payload = payload_factory()
            try:
                self.publish(event_name, payload, lab_code=lab_code)
            except HTTPException as exc:
                self.log("error", f"自动回传 {event_name} 失败：{exc.detail}", payload)
            except Exception as exc:
                self.log("error", f"自动回传 {event_name} 失败：{exc}", payload)

        timer = threading.Timer(AUTO_REPLY_DELAY_SECONDS, publish_later)
        timer.daemon = True
        timer.start()
        self.log("info", f"自动模式已安排 {AUTO_REPLY_DELAY_SECONDS:g} 秒后回传 {event_name}", {"lab_code": lab_code})

    def _context_payload(self, lab_code: str, request_run_no: str = "", extra: dict[str, Any] | None = None) -> dict[str, Any]:
        with self._lock:
            context = dict(self._lab_contexts.get(normalize_text(lab_code), {}))
        run_no = normalize_text(request_run_no) or normalize_text(context.get("run_no"))
        if run_no:
            context["run_no"] = run_no
        for key, value in (extra or {}).items():
            if isinstance(value, list):
                normalized_values = [normalize_text(item) for item in value if normalize_text(item)]
                if normalized_values:
                    context[key] = normalized_values
                continue
            normalized_value = normalize_text(value)
            if normalized_value:
                context[key] = normalized_value
        return {
            key: value
            for key, value in context.items()
            if key not in MES_ONLY_COMMAND_FIELDS
            and (bool(value) if isinstance(value, list) else bool(normalize_text(value)))
        }

    def _event_request_context(self, request: EventRequest) -> dict[str, Any]:
        return {
            "axis_codes": request.axis_codes,
            "axis_batch_no": request.axis_batch_no,
            "current_axis_code": request.current_axis_code,
        }

    def _maybe_auto_reply(self, command: str, topic: str, payload: Any) -> None:
        if isinstance(payload, dict):
            payload = without_schedule_context(payload)
        with self._lock:
            auto_mode = self._config.auto_mode
        if not auto_mode:
            return
        lab_code = self._resolve_message_lab_code(topic, payload)
        if command == "fixture-install":
            self._schedule_auto_publish(
                "fixture-ready",
                lab_code,
                lambda: {
                    "lab_code": lab_code,
                    **self._context_payload(lab_code),
                    "success_id": "OK",
                    "fixture_ready_at": beijing_now_text(),
                },
            )
            return
        if command == "experiment-ready":
            # Snapshot the context for this command before scheduling the reply.
            # A later ready command for the same run may switch to another axis;
            # its context must not leak into this delayed experiment-started event.
            ready_payload = payload if isinstance(payload, dict) else {}
            resume_preparation = ready_payload.get("resume_preparation")
            if resume_preparation is True or normalize_text(resume_preparation).lower() in {"1", "true", "yes", "on"}:
                self.log(
                    "info",
                    "继续实验准备已就绪，等待 MES 下发 experiment-resume-request",
                    ready_payload,
                    topic,
                )
                return
            ready_context = self._context_payload(
                lab_code,
                normalize_text(ready_payload.get("run_no") or ready_payload.get("runNo")),
            )
            self._schedule_auto_publish(
                "experiment-started",
                lab_code,
                lambda context=ready_context: {
                    "lab_code": lab_code,
                    **context,
                    "started_at": beijing_now_text(),
                },
            )
            return
        if command == "experiment-end-request":
            self._schedule_immediate_experiment_end(lab_code, payload)
            return
        salt_control_events = {
            "experiment-pause-request": ("experiment-paused", "paused_at"),
            "experiment-resume-request": ("experiment-resumed", "resumed_at"),
            "experiment-stop-request": ("experiment-stopped", "stopped_at"),
        }
        salt_control_event = salt_control_events.get(command)
        if salt_control_event:
            request_payload = dict(payload) if isinstance(payload, dict) else {}
            event_name, event_time_field = salt_control_event
            # Snapshot the exact control-command correlation context. A later
            # command for this laboratory must not overwrite the delayed ACK.
            reply_payload = {
                **request_payload,
                "lab_code": lab_code,
                "message_id": f"HOST-{event_name.upper()}-{uuid.uuid4().hex}",
            }
            reply_payload.pop("occurred_at", None)
            self._schedule_auto_publish(
                event_name,
                lab_code,
                lambda context=reply_payload, time_field=event_time_field: {
                    **context,
                    time_field: beijing_now_text(),
                },
            )

    def publish(self, event_name: str, payload: dict[str, Any], lab_code: str | None = None) -> dict[str, Any]:
        payload = without_schedule_context(payload)
        with self._lock:
            client = self._client
            config = self._config
            connected = self._connected
        if client is None or not connected:
            raise HTTPException(status_code=409, detail="MQTT 尚未连接")

        prefix = normalize_prefix(config.topicPrefix)
        target_lab_code = normalize_text(lab_code) or config.lab_code
        topic = f"{prefix}/labs/{target_lab_code}/events/{event_name}"
        payload_text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        try:
            result = client.publish(topic, payload_text, qos=0, retain=False)
            result.wait_for_publish(timeout=5)
        except Exception as exc:
            self.log("error", f"发送事件失败：{exc}", payload, topic)
            raise HTTPException(status_code=503, detail=f"发送事件失败：{exc}") from exc

        ok = getattr(result, "rc", 1) == 0
        level = "send" if ok else "error"
        self.log(level, f"发送上位机事件：{event_name}", payload, topic)
        return {"ok": ok, "topic": topic, "payload": payload}

    def current_lab_code(self) -> str:
        with self._lock:
            return self._config.lab_code


simulator = MqttSimulator()
app = FastAPI(title="MES 上位机模拟器", version=SIMULATOR_VERSION)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(
        BASE_DIR / "static" / "index.html",
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@app.get("/api/state")
def get_state() -> dict[str, Any]:
    return simulator.state()


@app.get("/api/logs")
def get_logs() -> dict[str, Any]:
    return {"logs": simulator.logs()}


@app.get("/api/telemetry")
def get_telemetry() -> dict[str, Any]:
    return {**simulator.telemetry_meta(), "items": simulator.telemetry_state()}


@app.patch("/api/telemetry")
def update_telemetry(request: TelemetryUpdateRequest) -> dict[str, Any]:
    return simulator.update_telemetry(request)


@app.post("/api/connect")
def connect(config: MqttConfig) -> dict[str, Any]:
    return simulator.connect(config)


@app.post("/api/disconnect")
def disconnect() -> dict[str, Any]:
    return simulator.disconnect()


@app.post("/api/events/fixture-ready")
def publish_fixture_ready(request: FixtureReadyRequest) -> dict[str, Any]:
    lab_code = simulator.current_lab_code()
    payload = {
        "lab_code": lab_code,
        **simulator._context_payload(lab_code),
        "success_id": normalize_text(request.success_id) or "OK",
        "fixture_ready_at": normalize_text(request.event_time) or beijing_now_text(),
    }
    return simulator.publish("fixture-ready", payload)


@app.post("/api/events/experiment-started")
def publish_experiment_started(request: EventRequest) -> dict[str, Any]:
    lab_code = simulator.current_lab_code()
    payload = {
        "lab_code": lab_code,
        **simulator._context_payload(lab_code, request.run_no, simulator._event_request_context(request)),
        "started_at": normalize_text(request.event_time) or beijing_now_text(),
    }
    return simulator.publish("experiment-started", payload)


@app.post("/api/events/experiment-ended")
def publish_experiment_ended(request: EventRequest) -> dict[str, Any]:
    lab_code = simulator.current_lab_code()
    context = simulator._context_payload(lab_code, request.run_no, simulator._event_request_context(request))
    if request.event_time:
        context["ended_at"] = normalize_text(request.event_time)
    return simulator._publish_experiment_end_once(lab_code, context)


@app.post("/api/events/experiment-result")
def publish_experiment_result(request: EventRequest) -> dict[str, Any]:
    lab_code = simulator.current_lab_code()
    payload = {
        "lab_code": lab_code,
        **simulator._context_payload(lab_code, request.run_no, simulator._event_request_context(request)),
        "result_at": normalize_text(request.event_time) or beijing_now_text(),
        "result_package": request.result_package or {
            "conclusion": "PASS",
            "summary": "实验结果正常",
            "files": [],
        },
    }
    return simulator.publish("experiment-result", payload)
