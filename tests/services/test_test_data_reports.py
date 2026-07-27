from __future__ import annotations

from copy import deepcopy
import builtins
from pathlib import Path

from pypdf import PdfReader

from app.core.mysql_storage_backend import SNAPSHOT_STORAGE_KEYS
from app.core.storage_contract import STORAGE_KEYS
from app.services import test_data_reports


class MemoryStorage:
    def __init__(self, values=None):
        self.values = deepcopy(values or {})

    def read(self, key):
        return deepcopy(self.values.get(key, []))

    def write(self, key, value):
        self.values[key] = deepcopy(value)


def report_snapshot():
    return {
        "tasks": [{"code": "TASK:001"}],
        "experiments": [
            {
                "task_code": "TASK:001",
                "experiment_code": "EXP-VIB",
                "experiment_name": "振动试验",
                "required_device": "振动一室",
            }
        ],
        "schedules": [
            {
                "id": "SCH-1",
                "task_code": "TASK:001",
                "experiment_code": "EXP-VIB",
                "device": "振动一室",
            }
        ],
        "experiment_runs": [
            {
                "run_no": "RUN-1",
                "task_code": "TASK:001",
                "experiment_code": "EXP-VIB",
                "schedule_id": "SCH-1",
                "started_at": "2026-07-27 09:40:00",
            }
        ],
        "experiment_run_trays": [
            {
                "run_no": "RUN-1",
                "task_code": "TASK:001",
                "experiment_code": "EXP-VIB",
                "tray_code": "TRAY-1",
            }
        ],
        "experiment_run_steps": [
            {
                "run_no": "RUN-1",
                "task_code": "TASK:001",
                "experiment_code": "EXP-VIB",
                "axis_code": "x+",
                "started_at": "2026-07-27 09:45:00",
                "status": "实验进行中",
            }
        ],
        "experiment_samples": [
            {"task_code": "TASK:001", "experiment_code": "EXP-VIB", "sample_code": "SP:001"},
            {"task_code": "TASK:001", "experiment_code": "EXP-VIB", "sample_code": "SP-OTHER"},
        ],
        "samples": [
            {"code": "SP:001", "task_code": "TASK:001", "trays": [{"tray_code": "TRAY-1"}]},
            {"code": "SP-OTHER", "task_code": "TASK:001", "trays": [{"tray_code": "TRAY-OTHER"}]},
        ],
    }


def completion_result(snapshot, *, axis=False):
    result = {
        "affectedTrayCodes": [] if axis else ["TRAY-1"],
        "completedAt": "2026-07-27 10:00:00",
        "experiments": deepcopy(snapshot["experiments"]),
        "schedules": deepcopy(snapshot["schedules"]),
        "experimentRuns": [
            {**snapshot["experiment_runs"][0], "ended_at": "2026-07-27 10:00:00"}
        ],
        "experimentRunTrays": deepcopy(snapshot["experiment_run_trays"]),
        "samples": deepcopy(snapshot["samples"]),
    }
    if axis:
        result["experimentRunSteps"] = [
            {**snapshot["experiment_run_steps"][0], "ended_at": "2026-07-27 09:55:00", "status": "实验已完成"}
        ]
    return result


def configured_storage(tmp_path):
    return MemoryStorage(
        {
            test_data_reports.SETTINGS_STORAGE_KEY: [
                {"savePath": str(tmp_path), "updatedAt": "2026-07-27 08:00:00"}
            ],
            test_data_reports.EXPORTS_STORAGE_KEY: [],
        }
    )


def test_archive_axis_completion_uses_step_time_safe_paths_and_is_idempotent(tmp_path, monkeypatch):
    storage = configured_storage(tmp_path)
    snapshot = report_snapshot()
    result = completion_result(snapshot, axis=True)
    monkeypatch.setattr(test_data_reports, "get_storage_backend", lambda: storage)

    first = test_data_reports.archive_completion_reports(
        snapshot=snapshot,
        result=result,
        task_code="TASK:001",
        experiment_code="EXP-VIB",
        run_no="RUN-1",
        axis_code="X+",
        completed_at="2026-07-27 09:55:00",
    )

    assert first["ok"] is True
    assert first["succeeded"] == 1
    assert first["failed"] == 0
    record = first["items"][0]
    report_path = Path(record["filePath"])
    assert report_path.relative_to(tmp_path).parts == (
        "TASK_001",
        "振动试验",
        "X+轴向",
        "2026-07-27 09.45-09.55",
        "SP_001.pdf",
    )
    assert report_path.is_file()
    assert len(PdfReader(report_path).pages) == 1

    second = test_data_reports.archive_completion_reports(
        snapshot=snapshot,
        result=result,
        task_code="TASK:001",
        experiment_code="EXP-VIB",
        run_no="RUN-1",
        axis_code="x+",
        completed_at="2026-07-27 09:55:00",
    )
    assert second["attempted"] == 0
    assert second["skipped"] == 1
    assert len(storage.values[test_data_reports.EXPORTS_STORAGE_KEY]) == 1


def test_archive_ordinary_completion_uses_run_time_and_one_pdf_per_batch_sample(tmp_path, monkeypatch):
    storage = configured_storage(tmp_path)
    snapshot = report_snapshot()
    result = completion_result(snapshot)
    monkeypatch.setattr(test_data_reports, "get_storage_backend", lambda: storage)

    summary = test_data_reports.archive_completion_reports(
        snapshot=snapshot,
        result=result,
        task_code="TASK:001",
        experiment_code="EXP-VIB",
        run_no="RUN-1",
        completed_at="2026-07-27 10:00:00",
    )

    assert summary["succeeded"] == 1
    relative_path = Path(summary["items"][0]["relativePath"])
    assert relative_path.parts == (
        "TASK_001",
        "振动试验",
        "2026-07-27 09.40-10.00",
        "SP_001.pdf",
    )


def test_archive_records_pdf_failure_without_raising_and_retry_succeeds(tmp_path, monkeypatch):
    storage = configured_storage(tmp_path)
    snapshot = report_snapshot()
    result = completion_result(snapshot)
    monkeypatch.setattr(test_data_reports, "get_storage_backend", lambda: storage)
    original_writer = test_data_reports._write_report_pdf
    monkeypatch.setattr(test_data_reports, "_write_report_pdf", lambda *_args: (_ for _ in ()).throw(OSError("disk full")))

    summary = test_data_reports.archive_completion_reports(
        snapshot=snapshot,
        result=result,
        task_code="TASK:001",
        experiment_code="EXP-VIB",
        run_no="RUN-1",
    )

    assert summary["ok"] is False
    assert summary["failed"] == 1
    failed_record = storage.values[test_data_reports.EXPORTS_STORAGE_KEY][0]
    assert failed_record["status"] == "failed"
    assert "disk full" in failed_record["error"]

    monkeypatch.setattr(test_data_reports, "_write_report_pdf", original_writer)
    retry = test_data_reports.retry_failed_exports(storage=storage)
    assert retry["ok"] is True
    assert retry["succeeded"] == 1
    assert Path(retry["items"][0]["filePath"]).is_file()


def test_archive_reports_missing_batch_samples_without_raising(tmp_path, monkeypatch):
    storage = configured_storage(tmp_path)
    snapshot = report_snapshot()
    snapshot["samples"] = []
    result = completion_result(snapshot)
    monkeypatch.setattr(test_data_reports, "get_storage_backend", lambda: storage)

    summary = test_data_reports.archive_completion_reports(
        snapshot=snapshot,
        result=result,
        task_code="TASK:001",
        experiment_code="EXP-VIB",
        run_no="RUN-1",
    )

    assert summary["ok"] is False
    assert summary["failed"] == 1
    assert "未找到" in summary["error"]


def test_save_path_requires_an_absolute_writable_directory(tmp_path):
    storage = MemoryStorage()
    settings = test_data_reports.update_test_data_settings(tmp_path / "reports", storage=storage)
    assert settings["writable"] is True
    assert Path(settings["savePath"]).is_dir()
    assert test_data_reports.read_test_data_settings(storage=storage)["savePath"] == settings["savePath"]

    try:
        test_data_reports.update_test_data_settings("relative/reports", storage=storage)
    except ValueError as exc:
        assert "绝对路径" in str(exc)
    else:
        raise AssertionError("relative save path should be rejected")


def test_cross_day_batch_folder_keeps_both_dates():
    assert test_data_reports.batch_folder_name(
        "2026-07-27 23:40:00",
        "2026-07-28 00:20:00",
    ) == "2026-07-27 23.40-2026-07-28 00.20"


def test_missing_reportlab_only_disables_pdf_generation(tmp_path, monkeypatch):
    original_import = builtins.__import__

    def reject_reportlab(name, *args, **kwargs):
        if name == "reportlab" or name.startswith("reportlab."):
            raise ImportError("reportlab unavailable")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", reject_reportlab)

    try:
        test_data_reports._write_report_pdf(tmp_path / "missing.pdf", {"taskCode": "TASK-001"})
    except RuntimeError as exc:
        assert "reportlab" in str(exc)
    else:
        raise AssertionError("missing reportlab should produce a scoped PDF error")


def test_report_settings_and_exports_are_mysql_snapshot_keys():
    assert test_data_reports.SETTINGS_STORAGE_KEY in STORAGE_KEYS
    assert test_data_reports.EXPORTS_STORAGE_KEY in STORAGE_KEYS
    assert test_data_reports.SETTINGS_STORAGE_KEY in SNAPSHOT_STORAGE_KEYS
    assert test_data_reports.EXPORTS_STORAGE_KEY in SNAPSHOT_STORAGE_KEYS
