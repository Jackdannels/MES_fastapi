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
