from __future__ import annotations

import importlib.util
from pathlib import Path
import subprocess
import sys


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "stage4_soak_probe.py"
SPEC = importlib.util.spec_from_file_location("stage4_soak_probe", SCRIPT_PATH)
assert SPEC and SPEC.loader
stage4 = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = stage4
SPEC.loader.exec_module(stage4)


def capacity(*, status="ok", mq=10, experiments=5, staging=2, retention_error=""):
    return {
        "status": status,
        "tables": [
            {"tableName": "biz_mq_message_log", "estimatedRows": mq},
            {"tableName": "biz_experiment_event", "estimatedRows": experiments},
        ],
        "snapshots": [{"storageKey": "mes.staging_events", "itemCount": staging}],
        "retention": {
            "enabled": True,
            "scheduled": True,
            "running": False,
            "lastError": retention_error,
        },
    }


def test_soak_report_passes_for_stable_read_only_data_and_capacity():
    report = stage4.finalize_soak_report(
        {"passed": True, "failures": [], "overall": {"p95Ms": 50}},
        profile_before={"contentSha256": "same"},
        profile_after={"contentSha256": "same"},
        capacity_before=capacity(),
        capacity_after=capacity(mq=11, experiments=6),
        max_event_row_growth=10,
        max_staging_event_growth=0,
    )

    assert report["passed"] is True
    assert report["soak"]["growth"] == {
        "mqMessageRows": 1,
        "experimentEventRows": 1,
        "stagingEventItems": 0,
    }


def test_soak_report_fails_for_drift_capacity_warning_or_retention_error():
    report = stage4.finalize_soak_report(
        {"passed": True, "failures": []},
        profile_before={"contentSha256": "before"},
        profile_after={"contentSha256": "after"},
        capacity_before=capacity(),
        capacity_after=capacity(status="warning", mq=30, staging=3, retention_error="cleanup failed"),
        max_event_row_growth=5,
        max_staging_event_growth=0,
    )

    assert report["passed"] is False
    assert len(report["failures"]) == 5


def test_soak_report_allows_retention_to_prune_staging_events_without_business_drift():
    before = {
        "contentSha256": "global-before",
        "contentSha256ByKey": {"mes.tasks": "tasks-same", "mes.staging_events": "staging-before"},
    }
    after = {
        "contentSha256": "global-after",
        "contentSha256ByKey": {"mes.tasks": "tasks-same", "mes.staging_events": "staging-after"},
    }

    report = stage4.finalize_soak_report(
        {"passed": True, "failures": []},
        profile_before=before,
        profile_after=after,
        capacity_before=capacity(staging=10),
        capacity_after=capacity(staging=8),
        max_event_row_growth=0,
        max_staging_event_growth=0,
    )

    assert report["passed"] is True
    assert report["soak"]["changedBusinessProfileKeys"] == []
    assert report["soak"]["growth"]["stagingEventItems"] == -2


def test_soak_report_requires_enabled_scheduled_retention_runtime():
    after = capacity()
    after["retention"] = {"enabled": False, "scheduled": False, "running": False, "lastError": ""}

    report = stage4.finalize_soak_report(
        {"passed": True, "failures": []},
        profile_before={"contentSha256": "same"},
        profile_after={"contentSha256": "same"},
        capacity_before=capacity(),
        capacity_after=after,
        max_event_row_growth=0,
        max_staging_event_growth=0,
    )

    assert report["passed"] is False
    assert "留存清理器未启用" in report["failures"]
    assert "留存清理器未运行或未调度" in report["failures"]


def test_soak_probe_script_can_be_invoked_directly_from_repository_root():
    result = subprocess.run(
        [sys.executable, str(SCRIPT_PATH), "--help"],
        cwd=SCRIPT_PATH.parents[1],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )

    assert result.returncode == 0
    assert "--duration" in result.stdout
    assert "--window-seconds" in result.stdout
    assert "--docker-project" in result.stdout


def _window(*, requests=120, p95=50, errors=0, duration=60):
    endpoints = {
        name: {
            "requests": requests,
            "successful": requests - errors,
            "errors": errors,
            "p95Ms": p95,
            "maxMs": p95 + 10,
        }
        for name, _path in stage4.DEFAULT_ENDPOINTS
    }
    total = requests * len(endpoints)
    return {
        "durationSeconds": duration,
        "load": {
            "passed": errors == 0 and p95 <= 500,
            "failures": [],
            "overall": {
                "requests": total,
                "successful": total - errors * len(endpoints),
                "errors": errors * len(endpoints),
            },
            "endpoints": endpoints,
        },
    }


def test_window_aggregation_is_bounded_and_enforces_minimum_samples_and_p95():
    report = stage4.aggregate_window_reports(
        [_window(requests=60), _window(requests=60)],
        p95_limit_ms=500,
        min_requests_per_endpoint=100,
        max_throughput_drop=0.3,
    )

    assert report["passed"] is True
    assert report["overall"]["requests"] == 60 * 2 * len(stage4.DEFAULT_ENDPOINTS)
    assert report["endpoints"]["health"]["requests"] == 120
    assert "samples" not in report

    failed = stage4.aggregate_window_reports(
        [_window(requests=10, p95=501)],
        p95_limit_ms=500,
        min_requests_per_endpoint=100,
        max_throughput_drop=0.3,
    )
    assert failed["passed"] is False
    assert any("样本不足" in failure for failure in failed["failures"])
    assert any("窗口P95" in failure for failure in failed["failures"])


def test_docker_assessment_rejects_oom_restart_memory_and_missing_log_rotation():
    sample = {
        "containers": {
            "api": {
                "service": "api",
                "running": True,
                "health": "healthy",
                "oomKilled": True,
                "restartCount": 1,
                "dead": False,
                "logConfig": {"Type": "json-file", "Config": {}},
                "stats": {"memoryPercent": 85},
            },
            "migrate": {
                "service": "migrate",
                "running": False,
                "exitCode": 0,
                "oomKilled": False,
                "restartCount": 0,
                "dead": False,
                "logConfig": {"Type": "json-file", "Config": {"max-size": "10m", "max-file": "5"}},
            },
        }
    }

    failures = stage4.assess_docker_samples([sample], max_memory_percent=80)

    assert any("OOM" in failure for failure in failures)
    assert any("重启" in failure for failure in failures)
    assert any("内存" in failure for failure in failures)
    assert any("日志轮转" in failure for failure in failures)


def test_formal_soak_can_require_retention_completion_to_advance():
    before = capacity()
    before["retention"]["lastFinishedAt"] = "2026-08-02 00:00:00"
    after = capacity()
    after["retention"]["lastFinishedAt"] = "2026-08-02 00:00:00"

    report = stage4.finalize_soak_report(
        {"passed": True, "failures": []},
        profile_before={"contentSha256": "same"},
        profile_after={"contentSha256": "same"},
        capacity_before=before,
        capacity_after=after,
        max_event_row_growth=0,
        max_staging_event_growth=0,
        require_retention_run=True,
    )

    assert report["passed"] is False
    assert any("留存清理器" in failure for failure in report["failures"])


def test_formal_soak_rejects_a_finished_retention_run_that_did_not_acquire_the_lock() -> None:
    before = capacity()
    before["retention"]["lastFinishedAt"] = "2026-08-02 00:00:00"
    after = capacity()
    after["retention"].update({
        "lastFinishedAt": "2026-08-02 00:01:00",
        "lastResult": {"acquired": False, "skippedReason": "database-lock-active", "deleted": {}},
    })

    report = stage4.finalize_soak_report(
        {"passed": True, "failures": []},
        profile_before={"contentSha256": "same"},
        profile_after={"contentSha256": "same"},
        capacity_before=before,
        capacity_after=after,
        capacity_samples=[after],
        max_event_row_growth=0,
        max_staging_event_growth=0,
        require_retention_run=True,
    )

    assert report["passed"] is False
    assert any("获得数据库锁且结果完整" in failure for failure in report["failures"])


def test_formal_soak_records_complete_successful_retention_evidence() -> None:
    before = capacity()
    before["retention"].update({"lastFinishedAt": "2026-08-02 00:00:00", "totalDeleted": {}})
    after = capacity()
    deleted = {key: 0 for key in stage4.RETENTION_RESULT_KEYS}
    after["retention"].update({
        "lastFinishedAt": "2026-08-02 00:01:00",
        "lastResult": {"acquired": True, "deleted": deleted},
        "totalDeleted": deleted,
    })

    report = stage4.finalize_soak_report(
        {"passed": True, "failures": []},
        profile_before={"contentSha256": "same"},
        profile_after={"contentSha256": "same"},
        capacity_before=before,
        capacity_after=after,
        capacity_samples=[after],
        max_event_row_growth=0,
        max_staging_event_growth=0,
        require_retention_run=True,
    )

    assert report["passed"] is True
    assert report["soak"]["retentionEvidence"]["successfulRuns"][0]["deleted"] == deleted


def test_formal_soak_enforces_the_loaded_business_scale_before_and_after() -> None:
    expected = {
        "mes.tasks": 33,
        "mes.samples": 3200,
        "mes.experiments": 132,
        "mes.experiment_samples": 4800,
    }
    expected_identity = "d" * 64
    before = {"contentSha256": "same", "counts": dict(expected), "identitySha256": expected_identity}
    after = {
        "contentSha256": "same",
        "counts": {**expected, "mes.samples": 3199},
        "identitySha256": "e" * 64,
    }

    report = stage4.finalize_soak_report(
        {"passed": True, "failures": []},
        profile_before=before,
        profile_after=after,
        capacity_before=capacity(),
        capacity_after=capacity(),
        max_event_row_growth=0,
        max_staging_event_growth=0,
        expected_profile_counts=expected,
        expected_identity_sha256=expected_identity,
    )

    assert report["passed"] is False
    assert any("结束时业务规模不匹配: mes.samples=3199, expected=3200" in failure for failure in report["failures"])
    assert any("结束时业务身份签名不匹配" in failure for failure in report["failures"])
    assert report["soak"]["limits"]["expectedProfileCounts"] == expected
