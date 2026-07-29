from __future__ import annotations

import json
import logging
import re
import threading
import time
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Iterator


logger = logging.getLogger("mes.performance")

_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
_SERVER_TIMING_TOKEN_PATTERN = re.compile(r"[^A-Za-z0-9_.-]+")


@dataclass
class PerformanceTrace:
    request_id: str
    started_at: float = field(default_factory=time.perf_counter)
    durations_ms: dict[str, float] = field(default_factory=dict)
    counts: dict[str, int] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def add_duration(self, name: str, duration_ms: float) -> None:
        normalized = _normalize_metric_name(name)
        with self._lock:
            self.durations_ms[normalized] = self.durations_ms.get(normalized, 0.0) + max(0.0, duration_ms)

    def increment(self, name: str, value: int = 1) -> None:
        normalized = _normalize_metric_name(name)
        with self._lock:
            self.counts[normalized] = self.counts.get(normalized, 0) + value

    def snapshot(self) -> tuple[dict[str, float], dict[str, int]]:
        with self._lock:
            return dict(self.durations_ms), dict(self.counts)

    def server_timing(self, total_ms: float) -> str:
        durations, _counts = self.snapshot()
        values = [f"app;dur={max(0.0, total_ms):.2f}"]
        values.extend(
            f"{name};dur={duration_ms:.2f}"
            for name, duration_ms in sorted(durations.items())
        )
        return ", ".join(values)


_CURRENT_TRACE: ContextVar[PerformanceTrace | None] = ContextVar("mes_performance_trace", default=None)


def _normalize_metric_name(name: str) -> str:
    normalized = _SERVER_TIMING_TOKEN_PATTERN.sub("_", str(name or "metric").strip())
    return normalized[:64] or "metric"


def normalize_request_id(value: str | None) -> str:
    candidate = str(value or "").strip()
    if _REQUEST_ID_PATTERN.fullmatch(candidate):
        return candidate
    return uuid.uuid4().hex


def current_performance_trace() -> PerformanceTrace | None:
    return _CURRENT_TRACE.get()


@contextmanager
def performance_span(name: str) -> Iterator[None]:
    trace = current_performance_trace()
    if trace is None:
        yield
        return
    started_at = time.perf_counter()
    try:
        yield
    finally:
        trace.add_duration(name, (time.perf_counter() - started_at) * 1000)


def increment_performance_count(name: str, value: int = 1) -> None:
    trace = current_performance_trace()
    if trace is not None:
        trace.increment(name, value)


@contextmanager
def observed_lock(lock: Any, name: str) -> Iterator[None]:
    trace = current_performance_trace()
    wait_started_at = time.perf_counter()
    lock.acquire()
    if trace is not None:
        trace.add_duration(f"{name}.wait", (time.perf_counter() - wait_started_at) * 1000)
    hold_started_at = time.perf_counter()
    try:
        yield
    finally:
        if trace is not None:
            trace.add_duration(f"{name}.hold", (time.perf_counter() - hold_started_at) * 1000)
        lock.release()


class PerformanceMiddleware:
    def __init__(
        self,
        app: Any,
        *,
        enabled: bool = True,
        log_all_requests: bool = False,
        slow_request_ms: float = 500.0,
    ) -> None:
        self.app = app
        self.enabled = enabled
        self.log_all_requests = log_all_requests
        self.slow_request_ms = max(0.0, float(slow_request_ms))

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if not self.enabled or scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        request_id = normalize_request_id(headers.get(b"x-request-id", b"").decode("latin-1"))
        trace = PerformanceTrace(request_id=request_id)
        token = _CURRENT_TRACE.set(trace)
        response_status = 500
        response_bytes = 0
        response_finished = False

        async def observed_send(message: dict[str, Any]) -> None:
            nonlocal response_status, response_bytes, response_finished
            message_type = message.get("type")
            if message_type == "http.response.start":
                response_status = int(message.get("status", 500))
                elapsed_ms = (time.perf_counter() - trace.started_at) * 1000
                response_headers = list(message.get("headers", []))
                response_headers.append((b"x-request-id", request_id.encode("ascii")))
                response_headers.append((b"server-timing", trace.server_timing(elapsed_ms).encode("ascii")))
                _durations, phase_counts = trace.snapshot()
                response_headers.append((
                    b"x-mes-db-queries",
                    str(phase_counts.get("db.query.count", 0)).encode("ascii"),
                ))
                content_length = next(
                    (value for key, value in response_headers if key.lower() == b"content-length"),
                    None,
                )
                if content_length is not None:
                    response_headers.append((b"x-mes-response-bytes", content_length))
                message = {**message, "headers": response_headers}
            elif message_type == "http.response.body":
                response_bytes += len(message.get("body", b""))
                response_finished = not bool(message.get("more_body", False))
            await send(message)

        try:
            await self.app(scope, receive, observed_send)
        finally:
            total_ms = (time.perf_counter() - trace.started_at) * 1000
            durations, counts = trace.snapshot()
            should_log = self.log_all_requests or total_ms >= self.slow_request_ms or response_status >= 500
            if should_log:
                payload = {
                    "event": "http_request_performance",
                    "requestId": request_id,
                    "method": scope.get("method", ""),
                    "path": scope.get("path", ""),
                    "status": response_status,
                    "totalMs": round(total_ms, 2),
                    "responseBytes": response_bytes,
                    "responseFinished": response_finished,
                    "durationsMs": {key: round(value, 2) for key, value in sorted(durations.items())},
                    "counts": dict(sorted(counts.items())),
                }
                log_method = logger.warning if total_ms >= self.slow_request_ms or response_status >= 500 else logger.info
                log_method(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
            _CURRENT_TRACE.reset(token)
