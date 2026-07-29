from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

import pytest


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "run_p0_baselines.py"
SPEC = importlib.util.spec_from_file_location("run_p0_baselines", SCRIPT_PATH)
assert SPEC and SPEC.loader
runner = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = runner
SPEC.loader.exec_module(runner)


def test_runtime_target_must_match_the_confirmed_isolated_database() -> None:
    runner.validate_runtime_target(
        {"host": "127.0.0.1", "port": 3337, "database": "mes_p0_capacity"},
        expected_host="127.0.0.1",
        expected_port=3337,
        expected_database="mes_p0_capacity",
    )

    with pytest.raises(RuntimeError, match="目标不匹配"):
        runner.validate_runtime_target(
            {"host": "127.0.0.1", "port": 3306, "database": "mes_single_branch"},
            expected_host="127.0.0.1",
            expected_port=3337,
            expected_database="mes_p0_capacity",
        )


def test_fixture_profile_rejects_wrong_counts_or_identity() -> None:
    expected = runner.expected_fixture_profile()
    runner.validate_fixture_profile(expected, expected)
    wrong_count = {**expected, "counts": {**expected["counts"], "mes.samples": 3199}}
    with pytest.raises(RuntimeError, match="计数不匹配"):
        runner.validate_fixture_profile(wrong_count, expected)
    with pytest.raises(RuntimeError, match="身份签名不匹配"):
        runner.validate_fixture_profile({**expected, "identitySha256": "wrong"}, expected)


def test_report_uses_different_five_and_ten_user_thresholds() -> None:
    base_report = {
        "failures": [],
        "overall": {"p95Ms": 450},
        "endpoints": {
            "health": {"p95Ms": 120},
            "samples": {"p95Ms": 550},
        },
    }

    assert runner.evaluate_report(base_report, 5)
    assert runner.evaluate_report(base_report, 10) == []


def test_median_summary_uses_the_middle_run() -> None:
    reports = [
        {
            "overall": {"p50Ms": value, "p95Ms": value, "p99Ms": value, "maxMs": value, "averageResponseBytes": value},
            "endpoints": {"samples": {"p50Ms": value, "p95Ms": value, "p99Ms": value, "maxMs": value, "averageResponseBytes": value}},
        }
        for value in (300, 100, 200)
    ]

    summary = runner.median_summary(reports)

    assert summary["overall"]["p95Ms"] == 200
    assert summary["endpoints"]["samples"]["p95Ms"] == 200
