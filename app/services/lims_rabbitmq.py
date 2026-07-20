from __future__ import annotations

import asyncio
import json
import uuid
from contextlib import suppress
from threading import RLock
from typing import Any

from fastapi import HTTPException

from app.core.config import Settings
from app.core.storage_backend import get_storage_backend
from app.core.time_utils import now_business_text


INTAKE_MESSAGE_TYPE = "lims.external-intake.created.v1"
LIMS_OUTBOX_KEY = "mes.lims_outbox"
EXTERNAL_INTAKE_LOCK = RLock()


def task_code(task: dict[str, Any]) -> str:
    return str(task.get("code") or task.get("task_code") or task.get("taskNo") or task.get("task_no") or task.get("id") or "").strip()


class LimsRabbitRuntime:
    def __init__(self, app_settings: Settings, *, store_intake=None) -> None:
        self.settings = app_settings
        self.store_intake = store_intake
        self.connection: Any | None = None
        self.consumer_channel: Any | None = None
        self.publisher_channel: Any | None = None
        self.command_exchange: Any | None = None
        self.event_exchange: Any | None = None
        self.consumer_queue: Any | None = None
        self.outbox_task: asyncio.Task[Any] | None = None
        self.last_error = ""

    @property
    def connected(self) -> bool:
        return bool(self.connection and not self.connection.is_closed)

    async def start(self) -> None:
        if not self.settings.RABBITMQ_ENABLED or self.connected:
            return
        try:
            import aio_pika

            self.connection = await aio_pika.connect_robust(self.settings.RABBITMQ_URL, timeout=8)
            self.consumer_channel = await self.connection.channel()
            self.publisher_channel = await self.connection.channel(publisher_confirms=True)
            await self.consumer_channel.set_qos(prefetch_count=max(1, int(self.settings.RABBITMQ_PREFETCH_COUNT)))
            self.command_exchange = await self.consumer_channel.declare_exchange(
                self.settings.RABBITMQ_COMMAND_EXCHANGE,
                aio_pika.ExchangeType.TOPIC,
                durable=True,
            )
            self.event_exchange = await self.publisher_channel.declare_exchange(
                self.settings.RABBITMQ_EVENT_EXCHANGE,
                aio_pika.ExchangeType.TOPIC,
                durable=True,
            )
            await self.consumer_channel.declare_exchange(
                self.settings.RABBITMQ_DLX_EXCHANGE,
                aio_pika.ExchangeType.TOPIC,
                durable=True,
            )
            dead_letter_queue = await self.consumer_channel.declare_queue(
                f"{self.settings.RABBITMQ_INTAKE_QUEUE}.dlq",
                durable=True,
            )
            await dead_letter_queue.bind(self.settings.RABBITMQ_DLX_EXCHANGE, routing_key="#")
            self.consumer_queue = await self.consumer_channel.declare_queue(
                self.settings.RABBITMQ_INTAKE_QUEUE,
                durable=True,
                arguments={
                    "x-dead-letter-exchange": self.settings.RABBITMQ_DLX_EXCHANGE,
                    "x-delivery-limit": 5,
                    "x-queue-type": "quorum",
                    "x-single-active-consumer": True,
                },
            )
            await self.consumer_queue.bind(
                self.command_exchange,
                routing_key=self.settings.RABBITMQ_INTAKE_ROUTING_KEY,
            )
            await self.consumer_queue.consume(self._handle_intake_message)
            self.outbox_task = asyncio.create_task(self._publish_outbox_loop(), name="lims-outbox-publisher")
            self.last_error = ""
        except Exception as exc:
            self.last_error = str(exc)
            await self.stop()
            if self.settings.RABBITMQ_REQUIRED:
                raise RuntimeError(f"RabbitMQ LIMS integration startup failed: {exc}") from exc

    async def stop(self) -> None:
        if self.outbox_task:
            self.outbox_task.cancel()
            with suppress(asyncio.CancelledError):
                await self.outbox_task
            self.outbox_task = None
        if self.connection and not self.connection.is_closed:
            await self.connection.close()
        self.connection = None
        self.consumer_channel = None
        self.publisher_channel = None
        self.command_exchange = None
        self.event_exchange = None
        self.consumer_queue = None

    def status(self) -> dict[str, Any]:
        return {
            "enabled": bool(self.settings.RABBITMQ_ENABLED),
            "connected": self.connected,
            "queue": self.settings.RABBITMQ_INTAKE_QUEUE,
            "last_error": self.last_error,
        }

    @staticmethod
    def _decode_envelope(body: bytes) -> tuple[dict[str, Any], dict[str, Any]]:
        try:
            envelope = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"invalid JSON: {exc}") from exc
        if not isinstance(envelope, dict):
            raise ValueError("message envelope must be an object")
        if str(envelope.get("type") or "") != INTAKE_MESSAGE_TYPE:
            raise ValueError("unsupported message type")
        if int(envelope.get("schema_version") or 0) != 1:
            raise ValueError("unsupported schema version")
        if not str(envelope.get("message_id") or "").strip():
            raise ValueError("message_id is required")
        payload = envelope.get("payload")
        if not isinstance(payload, dict):
            raise ValueError("payload must be an object")
        return envelope, payload

    async def _handle_intake_message(self, message: Any) -> None:
        envelope: dict[str, Any] = {}
        payload: dict[str, Any] = {}
        try:
            envelope, payload = self._decode_envelope(message.body)
            if self.store_intake is None:
                raise RuntimeError("LIMS intake handler is not configured")
            await asyncio.to_thread(
                self.store_intake,
                payload,
                message_id=str(envelope.get("message_id") or ""),
            )
        except (ValueError, HTTPException) as exc:
            detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
            self.last_error = str(detail)
            with suppress(Exception):
                await self._publish_failure(envelope, payload, str(detail))
            await message.reject(requeue=False)
            return
        except Exception as exc:
            self.last_error = str(exc)
            await asyncio.sleep(1)
            await message.nack(requeue=True)
            return
        await message.ack()

    async def _publish_failure(self, envelope: dict[str, Any], payload: dict[str, Any], detail: str) -> None:
        intake_id = str(payload.get("lims_request_id") or payload.get("intake_id") or envelope.get("correlation_id") or "")
        event = {
            "event_id": uuid.uuid4().hex,
            "message_id": str(uuid.uuid4()),
            "correlation_id": intake_id,
            "type": "mes.external-intake.failed.v1",
            "schema_version": 1,
            "source": "MES",
            "occurred_at": now_business_text(),
            "routing_key": "mes.external-intake.failed.v1",
            "payload": {
                "lims_request_id": intake_id,
                "code": task_code(payload),
                "acceptance_status": "failed",
                "detail": detail,
            },
        }
        await self._publish_event(event)

    async def _publish_event(self, event: dict[str, Any]) -> None:
        if not self.event_exchange:
            raise RuntimeError("RabbitMQ event exchange is unavailable")
        import aio_pika

        body = {key: value for key, value in event.items() if key not in {"event_id", "routing_key"}}
        message = aio_pika.Message(
            json.dumps(body, ensure_ascii=False).encode("utf-8"),
            content_type="application/json",
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            message_id=str(event.get("message_id") or ""),
            correlation_id=str(event.get("correlation_id") or ""),
            type=str(event.get("type") or ""),
        )
        await self.event_exchange.publish(
            message,
            routing_key=str(event.get("routing_key") or "mes.external-intake.status.v1"),
            mandatory=True,
        )

    @staticmethod
    def _read_outbox() -> list[dict[str, Any]]:
        stored = get_storage_backend().read(LIMS_OUTBOX_KEY)
        return [dict(item) for item in stored] if isinstance(stored, list) else []

    @staticmethod
    def _remove_outbox_event(event_id: str) -> None:
        with EXTERNAL_INTAKE_LOCK:
            storage = get_storage_backend()
            stored = storage.read(LIMS_OUTBOX_KEY)
            outbox = [dict(item) for item in stored] if isinstance(stored, list) else []
            storage.write(LIMS_OUTBOX_KEY, [item for item in outbox if str(item.get("event_id") or "") != event_id])

    async def _publish_outbox_loop(self) -> None:
        while True:
            try:
                events = await asyncio.to_thread(self._read_outbox)
                for event in events:
                    await self._publish_event(event)
                    await asyncio.to_thread(self._remove_outbox_event, str(event.get("event_id") or ""))
                self.last_error = ""
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.last_error = str(exc)
            await asyncio.sleep(0.5)
