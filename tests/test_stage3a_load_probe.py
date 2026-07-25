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
