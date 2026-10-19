"""Container lifecycle around the unchanged simulator MQTT implementation."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import os

from .app import app, simulator, MqttConfig


def mqtt_config() -> MqttConfig:
    return MqttConfig(
        host=os.environ.get("MQTT_HOST", "rabbitmq"),
        port=int(os.environ.get("MQTT_PORT", "1883")),
        topicPrefix=os.environ.get("MQTT_TOPIC_PREFIX", "mes/v1"),
        username=os.environ.get("MQTT_USERNAME", ""),
        password=os.environ.get("MQTT_PASSWORD", ""),
        auto_mode=True,
    )


@asynccontextmanager
async def lifespan(_app):
    enabled = os.environ.get("SIMULATOR_AUTO_CONNECT", "false").lower() == "true"
    try:
        if enabled:
            config = mqtt_config()
            # A failed connection exits startup; Compose's restart policy retries.
            state = await asyncio.to_thread(simulator.connect, config)
            if not state.get("connected"):
                raise RuntimeError("Upper-computer simulator MQTT connection failed")
        yield
    finally:
        if enabled:
            await asyncio.to_thread(simulator.disconnect, silent=True)


app.router.lifespan_context = lifespan
