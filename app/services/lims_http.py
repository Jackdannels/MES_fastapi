"""Durable MES -> LIMS HTTP delivery, independent of the intake broker.

Business services append envelopes to LIMS_OUTBOX_KEY in their own commit.
Transport metadata is private and never changes an event's identity or payload.
"""
from __future__ import annotations

import asyncio
import json
import time
from contextlib import suppress
from threading import RLock
from typing import Any
from urllib import request, error as url_error

from app.core.config import Settings
from app.core.storage_backend import get_storage_backend
from app.services.laboratory_operations import acquire_laboratory_storage_commit_lock

LIMS_OUTBOX_KEY = "mes.lims_outbox"
EXTERNAL_INTAKE_LOCK = RLock()


def enqueue_lims_event(event: dict[str, Any]) -> None:
    """For standalone notifications; transactional producers write with business state."""
    if not event.get("event_id"):
        raise ValueError("event_id is required")
    with acquire_laboratory_storage_commit_lock(), EXTERNAL_INTAKE_LOCK:
        storage = get_storage_backend()
        events = list(storage.read(LIMS_OUTBOX_KEY) or [])
        if not any(item.get("event_id") == event["event_id"] for item in events):
            storage.write(LIMS_OUTBOX_KEY, [*events, event])


class _NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class LimsHttpRuntime:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.runner: asyncio.Task | None = None
        self.last_error = ""
        self.pending_count = 0
        self.delivered_count = 0
        self.completion_error = ""

    async def start(self) -> None:
        if self.settings.LIMS_HTTP_CALLBACK_URL and self.runner is None:
            self.runner = asyncio.create_task(self._run(), name="lims-http-outbox")

    async def stop(self) -> None:
        if self.runner:
            self.runner.cancel()
            with suppress(asyncio.CancelledError):
                await self.runner
            self.runner = None

    def status(self) -> dict[str, Any]:
        return {"enabled": bool(self.settings.LIMS_HTTP_CALLBACK_URL),
                "running": self.runner is not None and not self.runner.done(),
                "pending_count": self.pending_count, "delivered_count": self.delivered_count,
                "last_error": self.last_error, "completion_error": self.completion_error}

    def _post(self, event: dict[str, Any]) -> None:
        body = {key: value for key, value in event.items() if key not in {"routing_key", "_delivery"}}
        headers = {"Content-Type": "application/json", "Idempotency-Key": str(event["event_id"])}
        if self.settings.LIMS_HTTP_TOKEN:
            headers["Authorization"] = f"Bearer {self.settings.LIMS_HTTP_TOKEN}"
        req = request.Request(self.settings.LIMS_HTTP_CALLBACK_URL,
                              data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                              headers=headers, method="POST")
        # Do not follow redirects (in particular, never forward a bearer token).
        with request.build_opener(_NoRedirect).open(req, timeout=self.settings.LIMS_HTTP_TIMEOUT_SECONDS) as response:
            ack = json.loads(response.read(65537))
            if not 200 <= response.status < 300 or not isinstance(ack, dict) or ack.get("ok") is not True or ack.get("event_id") != event["event_id"]:
                raise ValueError("LIMS acknowledgement must contain ok=true and the matching event_id")

    @staticmethod
    def _read() -> list[dict[str, Any]]:
        return list(get_storage_backend().read(LIMS_OUTBOX_KEY) or [])

    @staticmethod
    def _finish(event_id: str, error: str = "") -> None:
        with acquire_laboratory_storage_commit_lock(), EXTERNAL_INTAKE_LOCK:
            storage = get_storage_backend()
            events = list(storage.read(LIMS_OUTBOX_KEY) or [])
            updated = []
            for event in events:
                if event.get("event_id") != event_id:
                    updated.append(event)
                elif error:
                    attempts = int(event.get("_delivery", {}).get("attempts", 0)) + 1
                    updated.append({**event, "_delivery": {
                        "attempts": attempts, "last_error": error[:500],
                        "next_attempt_at": time.time() + min(300, 2 ** min(attempts, 9)),
                    }})
            storage.write(LIMS_OUTBOX_KEY, updated)

    @staticmethod
    def _record_completion_delivery(event: dict[str, Any]) -> None:
        if event.get("type") != "mes.experiment.completion.v1":
            return
        from app.services.lims_completion_model import COMPLETION_KEY
        with acquire_laboratory_storage_commit_lock(), EXTERNAL_INTAKE_LOCK:
            storage = get_storage_backend()
            records = list(storage.read(COMPLETION_KEY) or [])
            for record in records:
                if record.get("event_id") == event.get("event_id"):
                    record["state"] = "delivered"
            storage.write(COMPLETION_KEY, records)

    async def deliver_once(self) -> None:
        events = await asyncio.to_thread(self._read)
        self.pending_count = len(events)
        self.last_error = ""
        for event in events:
            delivery = event.get("_delivery", {})
            if delivery.get("next_attempt_at", 0) > time.time():
                self.last_error = delivery.get("last_error", "")
                continue
            try:
                await asyncio.to_thread(self._post, event)
            except Exception as exc:
                # Avoid leaking URLs/tokens or response bodies into health endpoints.
                error = f"HTTP delivery failed ({type(exc).__name__})"
                if isinstance(exc, url_error.HTTPError):
                    error = f"HTTP delivery failed (status {exc.code})"
                self.last_error = error
                await asyncio.to_thread(self._finish, event["event_id"], error)
            else:
                await asyncio.to_thread(self._record_completion_delivery, event)
                await asyncio.to_thread(self._finish, event["event_id"])
                self.pending_count -= 1
                self.delivered_count += 1

    async def _run(self) -> None:
        from app.services.lims_completion import materialize_completions
        refresh_at = 0.0
        while True:
            try:
                if time.monotonic() >= refresh_at:
                    try:
                        await asyncio.to_thread(materialize_completions, public_base=self.settings.LIMS_DATA_PUBLIC_BASE_URL or self.settings.TEST_DATA_PUBLIC_BASE_URL)
                        self.completion_error = ""
                    except Exception as exc:
                        self.completion_error = f"Completion materialization failed ({type(exc).__name__})"
                    refresh_at = time.monotonic() + 5
                await self.deliver_once()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.last_error = f"Outbox unavailable ({type(exc).__name__})"
            await asyncio.sleep(1)
