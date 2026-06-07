from __future__ import annotations

import threading
from typing import Callable

from app.core.config import Settings, settings
from app.services.mq_subscriber import MqttSubscriberHandle, start_mqtt_subscriber
from app.services.upper_computer_simulator import ensure_upper_computer_simulator_auto_mode


HOST_INTERFACE_MODES = {"mock", "mqtt"}


class MqttRuntimeController:
    def __init__(
        self,
        app_settings: Settings = settings,
        *,
        starter: Callable[[Settings], MqttSubscriberHandle | None] = start_mqtt_subscriber,
        upper_computer_connector: Callable[[Settings], dict[str, object]] = ensure_upper_computer_simulator_auto_mode,
    ) -> None:
        self.app_settings = app_settings
        self.mode = "mock"
        self._starter = starter
        self._upper_computer_connector = upper_computer_connector
        self._upper_computer_status: dict[str, object] = {
            "enabled": bool(app_settings.UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE),
            "connected": False,
            "auto_mode": False,
            "reason": "paused",
        }
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
                self._upper_computer_status = {
                    "enabled": bool(self.app_settings.UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE),
                    "connected": False,
                    "auto_mode": False,
                    "reason": "paused",
                }
                return self._status_locked()

            if not self.app_settings.MQTT_ENABLED:
                self._stop_locked()
                self.mode = normalized_mode
                self._upper_computer_status = {
                    "enabled": bool(self.app_settings.UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE),
                    "connected": False,
                    "auto_mode": False,
                    "reason": "mqtt_disabled",
                }
                return self._status_locked()

            if self._subscriber is not None and not self._subscriber_is_running_locked():
                self._stop_locked()

            if self._subscriber is None:
                subscriber = self._starter(self.app_settings)
                self._subscriber = subscriber
            try:
                self._upper_computer_status = self._upper_computer_connector(self.app_settings)
            except Exception:
                if normalized_mode != self.mode:
                    self._stop_locked()
                self._upper_computer_status = {
                    "enabled": bool(self.app_settings.UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE),
                    "connected": False,
                    "auto_mode": False,
                    "reason": "startup_failed",
                }
                raise
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

    def _subscriber_is_running_locked(self) -> bool:
        subscriber = self._subscriber
        if subscriber is None:
            return False
        is_running = getattr(subscriber, "is_running", None)
        if not callable(is_running):
            return True
        try:
            return bool(is_running())
        except Exception:
            return True

    def _status_locked(self) -> dict[str, object]:
        subscriber_running = self._subscriber_is_running_locked()
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
            "upper_computer": dict(self._upper_computer_status),
            "reason": reason,
        }


default_mq_runtime = MqttRuntimeController(settings)
