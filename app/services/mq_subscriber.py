from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from app.core.config import Settings, settings
from app.services.mq_event_processor import process_laboratory_event


@dataclass
class MqttSubscriberHandle:
    client: Any

    def stop(self) -> None:
        self.client.loop_stop()
        self.client.disconnect()


def start_mqtt_subscriber(app_settings: Settings = settings) -> MqttSubscriberHandle | None:
    if not app_settings.MQTT_ENABLED:
        return None

    try:
        import paho.mqtt.client as mqtt
    except ImportError as exc:
        raise RuntimeError("paho-mqtt is required when MQTT_ENABLED=true") from exc

    client = mqtt.Client()
    username = str(app_settings.MQTT_USERNAME or "").strip()
    if username:
        client.username_pw_set(username, str(app_settings.MQTT_PASSWORD or ""))

    topic_prefix = str(app_settings.MQTT_TOPIC_PREFIX or "mes/v1").strip().strip("/")
    events_topic = f"{topic_prefix}/labs/+/events/#"

    def on_connect(mqtt_client: Any, _userdata: Any, _flags: Any, rc: int) -> None:
        if rc == 0:
            mqtt_client.subscribe(events_topic, qos=int(app_settings.MQTT_QOS))

    def on_message(_mqtt_client: Any, _userdata: Any, message: Any) -> None:
        payload = json.loads(message.payload.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("MQTT event payload must be a JSON object")
        process_laboratory_event(str(message.topic), payload)

    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(str(app_settings.MQTT_HOST), int(app_settings.MQTT_PORT), keepalive=60)
    client.loop_start()
    return MqttSubscriberHandle(client=client)
