from __future__ import annotations

import threading
from typing import Callable

from app.core.config import Settings, settings
from app.services.mq_subscriber import MqttSubscriberHandle, start_mqtt_subscriber


HOST_INTERFACE_MODES = {"mock", "mqtt"}


class MqttRuntimeController:
    def __init__(
        self,
        app_settings: Settings = settings,
        *,
        starter: Callable[[Settings], MqttSubscriberHandle | None] = start_mqtt_subscriber,
    ) -> None:
        self.app_settings = app_settings
        self.mode = "mock"
        self._starter = starter
        self._subscriber: MqttSubscriberHandle | None = None
        self._lock = threading.RLock()

    def status(self) -> dict[str, object]:
        with self._lock:
            return self._status_locked()

    def set_mode(self, mode: str) -> dict[str, object]:
        normalized_mode = str(mode or "").strip().lower()
        if normalized_mode not in HOST_INTERFACE_MODES:
            raise ValueError("mode must be mock or mqtt")

        with self._lock:
            if normalized_mode == "mock":
                self.mode = normalized_mode
                self._stop_locked()
                return self._status_locked()

            if not self.app_settings.MQTT_ENABLED:
                self._stop_locked()
                self.mode = normalized_mode
                return self._status_locked()

            if self._subscriber is None:
                subscriber = self._starter(self.app_settings)
                self._subscriber = subscriber
            self.mode = normalized_mode
            return self._status_locked()

    def shutdown(self) -> None:
        with self._lock:
            self._stop_locked()

    def _stop_locked(self) -> None:
        subscriber = self._subscriber
        self._subscriber = None
        if subscriber is not None:
            subscriber.stop()

    def _status_locked(self) -> dict[str, object]:
        subscriber_running = self._subscriber is not None
        reason = ""
        if self.mode == "mock":
            reason = "paused"
        elif not self.app_settings.MQTT_ENABLED:
            reason = "disabled"
        return {
            "ok": True,
            "mode": self.mode,
            "mqtt_enabled": bool(self.app_settings.MQTT_ENABLED),
            "subscriber_running": subscriber_running,
            "reason": reason,
        }


default_mq_runtime = MqttRuntimeController(settings)
