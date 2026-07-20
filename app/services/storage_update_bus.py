import asyncio
import json
import threading
from typing import Any

from app.core.time_utils import now_business_text


_SUBSCRIBERS: set[tuple[asyncio.AbstractEventLoop, asyncio.Queue[dict[str, Any]]]] = set()
_SUBSCRIBERS_LOCK = threading.Lock()


def publish_storage_update(keys: list[str], *, source: str = "", request_id: str = "") -> None:
    payload = {"keys": list(keys), "updatedAt": now_business_text()}
    if source:
        payload["source"] = source
    if request_id:
        payload["requestId"] = request_id
    with _SUBSCRIBERS_LOCK:
        subscribers = list(_SUBSCRIBERS)

    def enqueue(subscriber_queue: asyncio.Queue[dict[str, Any]]) -> None:
        if subscriber_queue.full():
            try:
                subscriber_queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
        try:
            subscriber_queue.put_nowait(payload)
        except asyncio.QueueFull:
            pass

    for subscriber_loop, subscriber_queue in subscribers:
        if subscriber_loop.is_closed():
            continue
        try:
            subscriber_loop.call_soon_threadsafe(enqueue, subscriber_queue)
        except RuntimeError:
            continue


async def storage_update_event_stream():
    subscriber_loop = asyncio.get_running_loop()
    subscriber_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=20)
    subscriber = (subscriber_loop, subscriber_queue)
    with _SUBSCRIBERS_LOCK:
        _SUBSCRIBERS.add(subscriber)
    try:
        yield ": connected\n\n"
        while True:
            try:
                payload = await asyncio.wait_for(subscriber_queue.get(), timeout=15)
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
                continue
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
    finally:
        with _SUBSCRIBERS_LOCK:
            _SUBSCRIBERS.discard(subscriber)
