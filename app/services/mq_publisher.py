from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timezone, timedelta
from typing import Any

from app.core.config import Settings, settings
from app.core.performance import increment_performance_count, performance_span
from app.db.session import get_connection
from app.services.mq_event_processor import MySQLMqEventRepository, normalize_text


COMMAND_TOPICS = {
    "INSTALL_FIXTURE": "fixture-install",
    "READY": "experiment-ready",
    "END_REQUEST": "experiment-end-request",
    "PAUSE_REQUEST": "experiment-pause-request",
    "RESUME_REQUEST": "experiment-resume-request",
    "STOP_REQUEST": "experiment-stop-request",
}
BEIJING_TZ = timezone(timedelta(hours=8))
logger = logging.getLogger("mes.mqtt.publisher")


def _mqtt_connection_key(app_settings: Settings) -> tuple[object, ...]:
    return (
        str(app_settings.MQTT_HOST),
        int(app_settings.MQTT_PORT),
        str(app_settings.MQTT_USERNAME or ""),
        str(app_settings.MQTT_PASSWORD or ""),
        int(app_settings.MQTT_QOS),
        float(app_settings.MQTT_CONNECT_TIMEOUT_SECONDS),
        float(app_settings.MQTT_PUBLISH_TIMEOUT_SECONDS),
    )


class MqttPublisher:
    """A process-local, thread-safe MQTT publisher with one persistent client."""

    def __init__(self, app_settings: Settings = settings) -> None:
        self.app_settings = app_settings
        self._client: Any | None = None
        self._connected = threading.Event()
        self._lock = threading.RLock()
        self._no_connection_rc = 4

    def start(self) -> None:
        if not self.app_settings.MQTT_ENABLED:
            return
        with self._lock:
            if self._client is not None:
                return
            client = self._build_client()
            loop_started = False
            started_ns = time.perf_counter_ns()
            try:
                with performance_span("mqtt.connect"):
                    connect_rc = client.connect(
                        str(self.app_settings.MQTT_HOST),
                        int(self.app_settings.MQTT_PORT),
                        keepalive=60,
                    )
                    if connect_rc not in (None, 0):
                        raise ConnectionError(f"mqtt_connect_rc_{connect_rc}")
                    client.loop_start()
                    loop_started = True
                    if not self._connected.wait(timeout=max(0.1, float(self.app_settings.MQTT_CONNECT_TIMEOUT_SECONDS))):
                        raise RuntimeError("mqtt_connect_timeout")
                self._client = client
            except Exception:
                self._connected.clear()
                # Disconnect first so loop_stop does not wait for the keepalive cycle.
                try:
                    client.disconnect()
                except Exception:
                    pass
                if loop_started:
                    try:
                        client.loop_stop()
                    except Exception:
                        pass
                duration_ms = (time.perf_counter_ns() - started_ns) / 1_000_000
                logger.exception(
                    json.dumps(
                        {
                            "event": "mqtt_publisher_connection",
                            "status": "failed",
                            "host": str(self.app_settings.MQTT_HOST),
                            "port": int(self.app_settings.MQTT_PORT),
                            "durationMs": round(duration_ms, 3),
                        },
                        ensure_ascii=False,
                        separators=(",", ":"),
                    )
                )
                raise
            duration_ms = (time.perf_counter_ns() - started_ns) / 1_000_000
            logger.info(
                json.dumps(
                    {
                        "event": "mqtt_publisher_connection",
                        "status": "connected",
                        "host": str(self.app_settings.MQTT_HOST),
                        "port": int(self.app_settings.MQTT_PORT),
                        "durationMs": round(duration_ms, 3),
                    },
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
            )

    def publish_json(self, topic: str, payload: dict[str, Any]) -> dict[str, Any]:
        payload_text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        qos = int(self.app_settings.MQTT_QOS)
        with self._lock:
            self.start()
            client = self._client
            if client is None:
                raise RuntimeError("mqtt_publisher_not_started")
            if not self._connected.wait(timeout=max(0.1, float(self.app_settings.MQTT_CONNECT_TIMEOUT_SECONDS))):
                raise RuntimeError("mqtt_reconnect_timeout")
            result = client.publish(topic, payload_text, qos=qos, retain=False)
            # Paho's network loop reconnects automatically. Cover the narrow race
            # where publish sees the lost socket before on_disconnect runs.
            if result.rc == self._no_connection_rc:
                self._connected.clear()
                if not self._connected.wait(timeout=max(0.1, float(self.app_settings.MQTT_CONNECT_TIMEOUT_SECONDS))):
                    raise RuntimeError("mqtt_reconnect_timeout")
                result = client.publish(topic, payload_text, qos=qos, retain=False)
            if result.rc != 0:
                return {
                    "published": False,
                    "reason": f"publish_rc_{result.rc}",
                    "topic": topic,
                }
            with performance_span("mqtt.publish.ack"):
                result.wait_for_publish(timeout=max(0.1, float(self.app_settings.MQTT_PUBLISH_TIMEOUT_SECONDS)))
            is_published = getattr(result, "is_published", None)
            if callable(is_published) and not is_published():
                return {
                    "published": False,
                    "reason": "publish_timeout",
                    "topic": topic,
                }
            return {
                "published": True,
                "reason": "",
                "topic": topic,
            }

    def shutdown(self) -> None:
        with self._lock:
            client = self._client
            self._client = None
            self._connected.clear()
            if client is None:
                return
            # This order prevents loop_stop from waiting for the network loop timeout.
            try:
                client.disconnect()
            except Exception:
                logger.exception("Failed to disconnect persistent MQTT publisher")
            try:
                client.loop_stop()
            except Exception:
                logger.exception("Failed to stop persistent MQTT publisher network loop")

    def _build_client(self) -> Any:
        try:
            import paho.mqtt.client as mqtt
        except ImportError as exc:
            raise RuntimeError("paho-mqtt is required when MQTT_ENABLED=true") from exc
        self._no_connection_rc = int(getattr(mqtt, "MQTT_ERR_NO_CONN", 4))

        callback_api = getattr(mqtt, "CallbackAPIVersion", None)
        if callback_api is None:
            client = mqtt.Client()
        else:
            client = mqtt.Client(callback_api_version=callback_api.VERSION2)
        username = str(self.app_settings.MQTT_USERNAME or "").strip()
        if username:
            client.username_pw_set(username, str(self.app_settings.MQTT_PASSWORD or ""))
        reconnect_delay_set = getattr(client, "reconnect_delay_set", None)
        if callable(reconnect_delay_set):
            reconnect_delay_set(min_delay=1, max_delay=30)

        def on_connect(_client: Any, _userdata: Any, _flags: Any, reason_code: Any, *_properties: Any) -> None:
            if reason_code == 0:
                self._connected.set()
            else:
                self._connected.clear()

        def on_disconnect(_client: Any, _userdata: Any, *_args: Any) -> None:
            self._connected.clear()

        client.on_connect = on_connect
        client.on_disconnect = on_disconnect
        return client


_publisher_registry_lock = threading.RLock()
_default_publisher: MqttPublisher | None = None
_default_publisher_key: tuple[object, ...] | None = None


def start_mqtt_publisher(app_settings: Settings = settings) -> MqttPublisher | None:
    """Start or return the publisher matching the active application settings."""
    global _default_publisher, _default_publisher_key
    if not app_settings.MQTT_ENABLED:
        return None
    key = _mqtt_connection_key(app_settings)
    with _publisher_registry_lock:
        if _default_publisher is not None and _default_publisher_key != key:
            _default_publisher.shutdown()
            _default_publisher = None
            _default_publisher_key = None
        if _default_publisher is None:
            publisher = MqttPublisher(app_settings)
            publisher.start()
            _default_publisher = publisher
            _default_publisher_key = key
        return _default_publisher


def shutdown_mqtt_publisher(app_settings: Settings | None = None) -> None:
    """Idempotently stop the active publisher, optionally only for matching settings."""
    global _default_publisher, _default_publisher_key
    with _publisher_registry_lock:
        if app_settings is not None and _default_publisher_key != _mqtt_connection_key(app_settings):
            return
        publisher = _default_publisher
        _default_publisher = None
        _default_publisher_key = None
        if publisher is not None:
            publisher.shutdown()


def now_message_text() -> str:
    return datetime.now(BEIJING_TZ).strftime("%Y-%m-%d %H:%M:%S.%f")


def build_laboratory_topic(command: str, lab_code: str, app_settings: Settings = settings) -> str:
    topic_name = COMMAND_TOPICS.get(command, command.lower().replace("_", "-"))
    prefix = str(app_settings.MQTT_TOPIC_PREFIX or "mes/v1").strip().strip("/")
    normalized_lab_code = str(lab_code or "").strip()
    return f"{prefix}/labs/{normalized_lab_code}/commands/{topic_name}"


def publish_laboratory_command(command: str, payload: dict[str, Any], app_settings: Settings = settings) -> dict[str, Any]:
    topic = build_laboratory_topic(command, str(payload.get("lab_code") or ""), app_settings)
    message_log_id = record_laboratory_command(
        command,
        topic,
        payload,
        {"published": False, "reason": "", "process_status": "SENDING"},
    )
    try:
        result = publish_mqtt_json(topic, payload, app_settings)
    except Exception as exc:
        update_laboratory_command_publish_result(
            message_log_id,
            {"published": False, "reason": str(exc), "process_status": "FAILED"},
        )
        raise
    update_laboratory_command_publish_result(message_log_id, result)
    return result


def record_laboratory_command(command: str, topic: str, payload: dict[str, Any], publish_result: dict[str, Any]) -> int:
    lab_code = normalize_text(payload.get("lab_code"))
    task_no = normalize_text(payload.get("task_code"))
    if not lab_code:
        return 0
    message_id = f"MES-{command}-{lab_code}-{task_no or 'NO_TASK'}-{now_message_text()}"
    try:
        message_log_id = MySQLMqEventRepository().record_message(
            {
                "message_id": message_id,
                "direction": "MES_TO_HOST",
                "topic": topic,
                "message_type": command,
                "correlation_id": normalize_text(
                    payload.get("fixture_install_id")
                    or payload.get("fixtureInstallId")
                    or payload.get("cancel_request_id")
                    or payload.get("cancelRequestId")
                ),
                "lab_code": lab_code,
                "task_no": task_no,
                "experiment_no": normalize_text(payload.get("experiment_code")),
                "qos": None,
                "retain_flag": False,
                "payload": payload,
                "process_status": normalize_text(publish_result.get("process_status"))
                or ("PROCESSED" if publish_result.get("published") else "SKIPPED"),
                "error_code": "",
                "error_message": normalize_text(publish_result.get("reason")),
            }
        )
        bind_laboratory_context(payload)
        return message_log_id
    except Exception:
        return 0


def update_laboratory_command_publish_result(message_log_id: int, publish_result: dict[str, Any]) -> None:
    if not message_log_id:
        return
    process_status = normalize_text(publish_result.get("process_status")) or (
        "PROCESSED" if publish_result.get("published") else "SKIPPED"
    )
    error_message = normalize_text(publish_result.get("reason"))
    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE biz_mq_message_log
                    SET process_status = %s,
                        error_message = %s,
                        processed_at = NOW()
                    WHERE message_log_id = %s
                    """,
                    (process_status, error_message, message_log_id),
                )
            connection.commit()
    except Exception:
        return


def bind_laboratory_context(payload: dict[str, Any]) -> None:
    lab_code = normalize_text(payload.get("lab_code"))
    task_no = normalize_text(payload.get("task_code"))
    experiment_no = normalize_text(payload.get("experiment_code"))
    if not lab_code or not task_no:
        return
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT lab_id
                FROM md_lab
                WHERE lab_code = %s
                LIMIT 1
                """,
                (lab_code,),
            )
            row = cursor.fetchone()
            lab_id = row.get("lab_id") if isinstance(row, dict) else row[0] if row else None
            if not lab_id:
                return
            experiment_join = ""
            experiment_filter = ""
            params: tuple[Any, ...]
            if experiment_no:
                experiment_join = """
                JOIN biz_experiment_tray et
                  ON et.task_no = task.task_no
                 AND et.tray_no = tr.tray_no
                """
                experiment_filter = "AND et.experiment_no = %s"
                params = (lab_id, task_no, experiment_no)
            else:
                params = (lab_id, task_no)
            cursor.execute(
                f"""
                UPDATE biz_tray tr
                JOIN biz_tray_item ti ON ti.tray_id = tr.tray_id
                JOIN biz_sample sm ON sm.sample_id = ti.sample_id
                JOIN biz_task task ON task.task_id = sm.task_id
                {experiment_join}
                SET tr.current_lab_id = %s
                WHERE task.task_no = %s
                  {experiment_filter}
                  AND (
                    ti.status IN (
                      '已到达实验室',
                      '工装夹具安装',
                      '实验准备就绪',
                      '实验进行中'
                    )
                    OR tr.test_state IN (
                      '已到达实验室',
                      '工装夹具安装',
                      '实验准备就绪',
                      '实验进行中'
                    )
                  )
                """,
                params,
            )
        connection.commit()


def publish_mqtt_json(topic: str, payload: dict[str, Any], app_settings: Settings = settings) -> dict[str, Any]:
    if not app_settings.MQTT_ENABLED:
        return {
            "published": False,
            "reason": "disabled",
            "topic": topic,
        }
    started_ns = time.perf_counter_ns()
    result: dict[str, Any] | None = None
    error = ""
    try:
        increment_performance_count("mqtt.publish.count")
        with performance_span("mqtt.publish"):
            publisher = start_mqtt_publisher(app_settings)
            if publisher is None:
                raise RuntimeError("mqtt_publisher_not_started")
            result = publisher.publish_json(topic, payload)
        increment_performance_count("mqtt.publish.success" if result["published"] else "mqtt.publish.failure")
        return result
    except Exception as exc:
        error = str(exc)
        increment_performance_count("mqtt.publish.failure")
        if isinstance(exc, RuntimeError):
            raise
        raise RuntimeError(str(exc)) from exc
    finally:
        duration_ms = (time.perf_counter_ns() - started_ns) / 1_000_000
        published = bool(result and result.get("published"))
        reason = error or str((result or {}).get("reason") or "")
        event = {
            "event": "mqtt_publish_performance",
            "topic": topic,
            "qos": int(app_settings.MQTT_QOS),
            "published": published,
            "reason": reason,
            "durationMs": round(duration_ms, 3),
        }
        log_payload = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
        if not published or duration_ms >= max(0.0, float(app_settings.MQTT_PUBLISH_SLOW_MS)):
            logger.warning(log_payload)
        else:
            logger.info(log_payload)
