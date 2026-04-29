from __future__ import annotations

import json
from typing import Any

from app.core.config import Settings, settings


COMMAND_TOPICS = {
    "INSTALL_FIXTURE": "fixture-install",
    "READY": "experiment-ready",
}


def build_laboratory_topic(command: str, lab_id: str, app_settings: Settings = settings) -> str:
    topic_name = COMMAND_TOPICS.get(command, command.lower().replace("_", "-"))
    prefix = str(app_settings.MQTT_TOPIC_PREFIX or "mes/v1").strip().strip("/")
    normalized_lab_id = str(lab_id or "").strip()
    return f"{prefix}/labs/{normalized_lab_id}/commands/{topic_name}"


def publish_laboratory_command(command: str, payload: dict[str, Any], app_settings: Settings = settings) -> dict[str, Any]:
    topic = build_laboratory_topic(command, str(payload.get("labId") or ""), app_settings)
    return publish_mqtt_json(topic, payload, app_settings)


def publish_mqtt_json(topic: str, payload: dict[str, Any], app_settings: Settings = settings) -> dict[str, Any]:
    if not app_settings.MQTT_ENABLED:
        return {
            "published": False,
            "reason": "disabled",
            "topic": topic,
        }

    try:
        import paho.mqtt.client as mqtt
    except ImportError as exc:
        raise RuntimeError("paho-mqtt is required when MQTT_ENABLED=true") from exc

    client = mqtt.Client()
    username = str(app_settings.MQTT_USERNAME or "").strip()
    if username:
        client.username_pw_set(username, str(app_settings.MQTT_PASSWORD or ""))

    payload_text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    loop_started = False
    try:
        client.connect(str(app_settings.MQTT_HOST), int(app_settings.MQTT_PORT), keepalive=60)
        client.loop_start()
        loop_started = True
        result = client.publish(topic, payload_text, qos=int(app_settings.MQTT_QOS), retain=False)
        result.wait_for_publish(timeout=10)
    finally:
        if loop_started:
            client.loop_stop()
        client.disconnect()

    return {
        "published": result.rc == 0,
        "reason": "" if result.rc == 0 else f"publish_rc_{result.rc}",
        "topic": topic,
    }
