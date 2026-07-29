from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.performance import PerformanceMiddleware, performance_span


def build_test_app(*, slow_request_ms: float = 500.0) -> FastAPI:
    app = FastAPI()
    app.add_middleware(
        PerformanceMiddleware,
        enabled=True,
        log_all_requests=False,
        slow_request_ms=slow_request_ms,
    )

    @app.get("/observed")
    def observed_route() -> dict[str, bool]:
        with performance_span("db.query"):
            return {"ok": True}

    return app


def test_performance_middleware_exposes_request_response_and_phase_headers() -> None:
    response = TestClient(build_test_app()).get(
        "/observed",
        headers={"X-Request-ID": "p0-request-1"},
    )

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "p0-request-1"
    assert int(response.headers["X-MES-Response-Bytes"]) > 0
    assert response.headers["X-MES-DB-Queries"] == "0"
    assert "app;dur=" in response.headers["Server-Timing"]
    assert "db.query;dur=" in response.headers["Server-Timing"]


def test_performance_middleware_replaces_invalid_request_id_and_logs_slow_request(caplog) -> None:
    caplog.set_level(logging.WARNING, logger="mes.performance")

    response = TestClient(build_test_app(slow_request_ms=0)).get(
        "/observed",
        headers={"X-Request-ID": "invalid request id"},
    )

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] != "invalid request id"
    assert any('"event":"http_request_performance"' in record.message for record in caplog.records)
    assert any('"responseBytes":' in record.message for record in caplog.records)
