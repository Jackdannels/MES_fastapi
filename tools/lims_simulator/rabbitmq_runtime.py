from __future__ import annotations

import asyncio
import json
import os
import uuid
from contextlib import suppress
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable


StatusHandler = Callable[[dict[str, Any]], Awaitable[None]]


class LimsRabbitClient:
    def __init__(self, status_handler: StatusHandler) -> None:
        self.url = os.getenv("RABBITMQ_URL", "amqp://guest:guest@127.0.0.1:5672/")
        self.command_exchange_name = os.getenv("RABBITMQ_COMMAND_EXCHANGE", "lims.mes.commands")
        self.event_exchange_name = os.getenv("RABBITMQ_EVENT_EXCHANGE", "mes.lims.events")
        self.status_queue_name = os.getenv("RABBITMQ_STATUS_QUEUE", "lims.external-intake-status.v1")
        self.intake_routing_key = os.getenv("RABBITMQ_INTAKE_ROUTING_KEY", "lims.external-intake.created.v1")
        self.status_handler = status_handler
        self.connection: Any | None = None
        self.channel: Any | None = None
        self.command_exchange: Any | None = None
        self.event_exchange: Any | None = None
        self.status_queue: Any | None = None
        self.runner_task: asyncio.Task[Any] | None = None
        self.last_error = ""

    @property
    def connected(self) -> bool:
        return bool(self.connection and not self.connection.is_closed and self.command_exchange)

    async def start(self) -> None:
        if not self.runner_task:
            self.runner_task = asyncio.create_task(self._run(), name="lims-rabbitmq-client")

    async def stop(self) -> None:
        if self.runner_task:
            self.runner_task.cancel()
            with suppress(asyncio.CancelledError):
                await self.runner_task
            self.runner_task = None
        if self.connection and not self.connection.is_closed:
            await self.connection.close()
        self.connection = None
        self.channel = None
        self.command_exchange = None
        self.event_exchange = None
        self.status_queue = None

    async def _run(self) -> None:
        import aio_pika

        while True:
            try:
                self.connection = await aio_pika.connect_robust(self.url, timeout=5)
                self.channel = await self.connection.channel(publisher_confirms=True)
                await self.channel.set_qos(prefetch_count=20)
                self.command_exchange = await self.channel.declare_exchange(
                    self.command_exchange_name,
                    aio_pika.ExchangeType.TOPIC,
                    durable=True,
                )
                self.event_exchange = await self.channel.declare_exchange(
                    self.event_exchange_name,
                    aio_pika.ExchangeType.TOPIC,
                    durable=True,
                )
                self.status_queue = await self.channel.declare_queue(self.status_queue_name, durable=True)
                await self.status_queue.bind(self.event_exchange, routing_key="mes.external-intake.*.v1")
                await self.status_queue.consume(self._handle_status)
                self.last_error = ""
                while self.connection and not self.connection.is_closed:
                    await asyncio.sleep(1)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.last_error = str(exc)
            self.connection = None
            self.channel = None
            self.command_exchange = None
            self.event_exchange = None
            self.status_queue = None
            await asyncio.sleep(1)

    async def _handle_status(self, message: Any) -> None:
        try:
            event = json.loads(message.body.decode("utf-8"))
            if not isinstance(event, dict):
                raise ValueError("status event must be an object")
            await self.status_handler(event)
        except Exception as exc:
            self.last_error = str(exc)
            await message.reject(requeue=False)
            return
        await message.ack()

    async def publish_intake(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.connected or not self.command_exchange:
            raise RuntimeError("RabbitMQ 未连接")
        import aio_pika

        message_id = str(uuid.uuid4())
        correlation_id = str(payload.get("lims_request_id") or payload.get("intake_id") or message_id)
        envelope = {
            "message_id": message_id,
            "correlation_id": correlation_id,
            "type": "lims.external-intake.created.v1",
            "schema_version": 1,
            "source": "LIMS",
            "occurred_at": datetime.now(timezone.utc).isoformat(),
            "payload": payload,
        }
        message = aio_pika.Message(
            json.dumps(envelope, ensure_ascii=False).encode("utf-8"),
            content_type="application/json",
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            message_id=message_id,
            correlation_id=correlation_id,
            type=envelope["type"],
        )
        await self.command_exchange.publish(message, routing_key=self.intake_routing_key, mandatory=True)
        return envelope

    def state(self) -> dict[str, Any]:
        safe_url = self.url
        if "@" in safe_url:
            safe_url = safe_url.split("@", 1)[1]
        return {
            "connected": self.connected,
            "rabbitmq_url": safe_url,
            "command_exchange": self.command_exchange_name,
            "status_queue": self.status_queue_name,
            "last_error": self.last_error,
        }
