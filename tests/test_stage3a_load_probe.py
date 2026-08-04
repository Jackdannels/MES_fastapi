from __future__ import annotations

import importlib.util
from pathlib import Path
import sys


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "stage3a_load_probe.py"
SPEC = importlib.util.spec_from_file_location("stage3a_load_probe", SCRIPT_PATH)
assert SPEC and SPEC.loader
stage3a_load_probe = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = stage3a_load_probe
SPEC.loader.exec_module(stage3a_load_probe)


def sample(endpoint: str, elapsed_ms: float, *, ok: bool = True):
    return stage3a_load_probe.RequestSample(
        endpoint=endpoint,
        elapsed_ms=elapsed_ms,
        ok=ok,
        response_bytes=100,
        status=200 if ok else 500,
    )


def test_percentile_uses_nearest_rank_for_small_capacity_samples() -> None:
    values = [10, 20, 30, 40, 50]

    assert stage3a_load_probe.percentile(values, 50) == 30
    assert stage3a_load_probe.percentile(values, 95) == 50
    assert stage3a_load_probe.percentile([], 95) == 0


def test_report_passes_when_every_endpoint_is_below_the_read_p95_limit() -> None:
    report = stage3a_load_probe.build_report(
        [sample("health", 10), sample("health", 20), sample("bootstrap", 100)],
        base_url="http://127.0.0.1:8000",
        duration_seconds=60,
        users=5,
        p95_limit_ms=500,
    )

    assert report["passed"] is True
    assert report["overall"]["errors"] == 0
    assert report["endpoints"]["health"]["p95Ms"] == 20


def test_report_fails_on_errors_or_an_endpoint_over_the_p95_limit() -> None:
    report = stage3a_load_probe.build_report(
        [sample("health", 10, ok=False), sample("bootstrap", 700)],
        base_url="http://127.0.0.1:8000",
        duration_seconds=60,
        users=5,
        p95_limit_ms=500,
    )

    assert report["passed"] is False
    assert report["overall"]["errors"] == 1
    assert len(report["failures"]) == 2


def test_report_summarizes_server_timing_phases_and_response_size() -> None:
    samples = [
        stage3a_load_probe.RequestSample(
            endpoint="samples", elapsed_ms=100, ok=True, response_bytes=1000, status=200,
            request_id="request-1", read_cache_status="miss", server_timings_ms={"app": 90, "db.query": 40},
        ),
        stage3a_load_probe.RequestSample(
            endpoint="samples", elapsed_ms=200, ok=True, response_bytes=3000, status=200,
            request_id="request-2", read_cache_status="hit", server_timings_ms={"app": 180, "db.query": 80},
        ),
    ]

    summary = stage3a_load_probe.summarize_samples(samples)

    assert summary["averageResponseBytes"] == 2000
    assert summary["serverTimings"]["db.query"]["p95Ms"] == 80
    assert summary["readCache"] == {"hit": 1, "miss": 1}
    assert summary["readCacheLatency"] == {
        "hit": {"requests": 1, "p50Ms": 200, "p95Ms": 200, "maxMs": 200},
        "miss": {"requests": 1, "p50Ms": 100, "p95Ms": 100, "maxMs": 100},
    }


def test_default_endpoints_follow_current_page_read_contracts() -> None:
    endpoints = dict(stage3a_load_probe.DEFAULT_ENDPOINTS)

    assert endpoints["samples"] == "/api/samples/page?page=1&pageSize=8"
    assert "mes.samples" not in endpoints["samples_context"]
    assert "mes.experiment_run_steps" in endpoints["samples_context"]
    assert "mes.experiment_runs" in endpoints["dashboard"]
    assert "mes.experiment_run_trays" in endpoints["dashboard"]
    assert "mes.experiment_trays" in endpoints["dashboard"]


def test_request_failure_keeps_path_and_utc_start(monkeypatch) -> None:
    def fail_request(*_args, **_kwargs):
        raise TimeoutError("timed out")

    monkeypatch.setattr(stage3a_load_probe.urllib.request, "urlopen", fail_request)

    sample = stage3a_load_probe.execute_request(
        "http://127.0.0.1:8000",
        ("samples", "/api/samples/page?page=1&pageSize=8"),
        5,
    )

    assert sample.ok is False
    assert sample.path == "/api/samples/page?page=1&pageSize=8"
    assert sample.started_at_utc.endswith("+00:00")


def test_parse_server_timing_ignores_unknown_parameters() -> None:
    assert stage3a_load_probe.parse_server_timing("app;dur=12.5, db.query;dur=4.25;desc=query") == {
        "app": 12.5,
        "db.query": 4.25,
    }


def test_data_profile_content_signature_is_stable_across_row_order_but_changes_with_status() -> None:
    first = stage3a_load_probe.build_data_profile({
        "mes.tasks": [{"code": "T-2", "status": "待排程"}, {"code": "T-1", "status": "已排程"}],
    })
    reordered = stage3a_load_probe.build_data_profile({
        "mes.tasks": [{"code": "T-1", "status": "已排程"}, {"code": "T-2", "status": "待排程"}],
    })
    changed = stage3a_load_probe.build_data_profile({
        "mes.tasks": [{"code": "T-1", "status": "实验进行中"}, {"code": "T-2", "status": "待排程"}],
    })

    assert first["contentSha256"] == reordered["contentSha256"]
    assert first["contentSha256"] != changed["contentSha256"]
    assert first["contentSha256ByKey"]["mes.tasks"] == reordered["contentSha256ByKey"]["mes.tasks"]
    assert first["contentSha256ByKey"]["mes.tasks"] != changed["contentSha256ByKey"]["mes.tasks"]
