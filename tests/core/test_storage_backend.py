from __future__ import annotations

import importlib
import os
import re
import sys
from pathlib import Path
from datetime import datetime, timedelta

import pytest

import app.core.storage_backend as storage_backend_module
from app.core.demo_data_reset import _random_axis_requirements, build_demo_reset_snapshot, reset_demo_data, run_demo_reset
from app.core.storage_backend import normalize_storage_payload


def test_normalize_storage_payload_does_not_scope_single_tray_experiment_history_entries() -> None:
    payload = {
        "mes.tasks": [],
        "mes.samples": [
            {
                "code": "SP-001",
                "task_code": "TASK-SINGLE",
                "trays": [{"tray_code": "TP-001", "status": "实验已完成"}],
                "history": [
                    {
                        "action": "实验完成",
                        "detail": "TASK-SINGLE / 冲击试验 / 实验已完成",
                        "status": "实验已完成",
                    }
                ],
            }
        ],
    }

    normalized = normalize_storage_payload(payload)

    assert "tray_code" not in normalized["mes.samples"][0]["history"][0]


def test_normalize_storage_payload_does_not_assign_returned_samples_by_sorted_tray_limit() -> None:
    task_code = "TASK-NO-SAMPLE-TRAY"
    payload = {
        "mes.tasks": [
            {
                "code": task_code,
                "status": "任务进行中",
                "transfer_status": "到货",
                "tray_limit": 1,
            }
        ],
        "mes.samples": [
            {"code": f"{task_code}-SP-001", "task_code": task_code, "status": "实验进行中", "flow_status": "实验进行中"},
            {"code": f"{task_code}-SP-002", "task_code": task_code, "status": "实验进行中", "flow_status": "实验进行中"},
        ],
        "mes.experiment_trays": [
            {"task_code": task_code, "experiment_code": f"{task_code}-A", "tray_code": f"{task_code}-TP-001"},
            {"task_code": task_code, "experiment_code": f"{task_code}-A", "tray_code": f"{task_code}-TP-002"},
        ],
        "mes.staging_events": [
            {
                "tray_code": f"{task_code}-TP-001",
                "task_code": task_code,
                "action": "manufacturer_return",
                "time": "2026-06-06 15:30:00",
                "target_lab": "厂家收回",
            },
            {
                "tray_code": f"{task_code}-TP-002",
                "task_code": task_code,
                "action": "manufacturer_return",
                "time": "2026-06-06 15:31:00",
                "target_lab": "厂家收回",
            },
        ],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)

    assert normalized["mes.tasks"][0]["transfer_status"] == "厂家收回"
    assert [sample["status"] for sample in normalized["mes.samples"]] == ["实验进行中", "实验进行中"]
    assert all("trays" not in sample for sample in normalized["mes.samples"])


def test_normalize_storage_payload_does_not_scope_ambiguous_multi_tray_experiment_history_entries() -> None:
    payload = {
        "mes.tasks": [],
        "mes.samples": [
            {
                "code": "SP-001",
                "task_code": "TASK-MULTI",
                "trays": [
                    {"tray_code": "TP-001", "status": "实验已完成"},
                    {"tray_code": "TP-002", "status": "实验进行中"},
                ],
                "history": [
                    {
                        "action": "实验完成",
                        "detail": "TASK-MULTI / 冲击试验 / 实验已完成",
                        "status": "实验已完成",
                    }
                ],
            }
        ],
    }

    normalized = normalize_storage_payload(payload)

    assert "tray_code" not in normalized["mes.samples"][0]["history"][0]


def test_demo_reset_snapshot_generates_20_fresh_tasks_with_expected_structure() -> None:
    current_time = datetime(2026, 5, 13, 9, 30, 0)
    snapshot = build_demo_reset_snapshot(now=current_time)

    tasks = snapshot["mes.tasks"]
    samples = snapshot["mes.samples"]
    experiments = snapshot["mes.experiments"]
    external_intakes = snapshot["mes.external_task_intakes"]

    assert len(tasks) == 20
    assert [task["code"] for task in tasks] == [f"SYLU-2026-05-{index:03d}" for index in range(1, 21)]
    assert tasks[0]["created_at"].startswith("2026-05-13 ")
    assert tasks[0]["arrival_at"].startswith("2026-05-13")
    assert tasks[0]["due_at"].startswith("2026-05-20")
    assert all(task["source"] == "外部委托" for task in tasks[:10])
    assert all(task["source"] == "内部新增" for task in tasks[10:])
    assert all(task["status"] == "待排程" for task in tasks)
    assert all(task["experiment_count"] == 3 for task in tasks)
    assert all(len(task["test_types"]) == 3 for task in tasks)
    assert all("盐雾试验" in str(task["test_type"]).split(" / ") for task in tasks)
    assert all("盐雾试验" in task["test_types"] for task in tasks)
    assert all(len(set(str(task["test_type"]).split(" / "))) == 3 for task in tasks)
    assert len(external_intakes) == 8
    assert [item["code"] for item in external_intakes] == [f"SYLU-2026-05-{index:03d}" for index in range(21, 29)]
    assert all(item["source"] == "外部委托" and item["acceptance_status"] == "pending" for item in external_intakes)
    assert all(str(item["client"]).endswith("单位") for item in external_intakes)

    assert len(experiments) == 60
    experiments_by_task = {}
    for experiment in experiments:
        experiments_by_task.setdefault(experiment["task_code"], []).append(experiment)
    assert set(experiments_by_task) == {task["code"] for task in tasks}
    assert all(len(task_experiments) == 3 for task_experiments in experiments_by_task.values())
    assert all(any(experiment["experiment_name"] == "盐雾试验" for experiment in task_experiments) for task_experiments in experiments_by_task.values())
    assert all(len({experiment["experiment_name"] for experiment in task_experiments}) == 3 for task_experiments in experiments_by_task.values())
    assert all(all(experiment["status"] == "待排程" for experiment in task_experiments) for task_experiments in experiments_by_task.values())
    axis_experiments = [
        experiment
        for experiment in experiments
        if experiment["experiment_name"] in {"冲击试验", "振动试验"}
    ]
    assert axis_experiments
    allowed_axis_codes = {"x+", "x-", "y+", "y-", "z+", "z-"}
    assert all(experiment["axis_codes"] for experiment in axis_experiments)
    assert all(set(experiment["axis_codes"]) <= allowed_axis_codes for experiment in axis_experiments)
    assert any(experiment["axis_codes"] != ["x+", "x-", "y+", "y-", "z+", "z-"] for experiment in axis_experiments)
    assert all(
        "axis_codes" not in experiment
        for experiment in experiments
        if experiment["experiment_name"] == "温度冲击试验"
    )

    samples_by_task = {}
    for sample in samples:
        samples_by_task.setdefault(sample["task_code"], []).append(sample)
        assert sample["status"] == "运输中"
        assert sample["flow_status"] == "运输中"
    assert set(samples_by_task) == {task["code"] for task in tasks}
    assert all(len(task_samples) > 4 for task_samples in samples_by_task.values())

    for task in tasks:
        assert re.fullmatch(r"SYLU-2026-05-\d{3}", task["code"])
        assert task["experiment_count"] == 3
        assert len(task["experiment_codes"]) == 3
        assert task["test_type"] == " / ".join(task["test_types"])

    assert snapshot["mes.schedules"] == []
    assert snapshot["mes.experiment_trays"] == []
    assert snapshot["mes.experiment_samples"] == []
    assert snapshot["mes.streams"] == []
    assert snapshot["mes.conflicts"] == []


def test_demo_reset_axis_requirements_use_random_count_and_standard_order() -> None:
    class _FakeRng:
        def shuffle(self, values):
            values[:] = ["z-", "x+", "y-", "x-", "z+", "y+"]

        def randint(self, start, end):
            assert start == 1
            assert end == 6
            return 3

    assert _random_axis_requirements(_FakeRng()) == ["x+", "y-", "z-"]


def test_normalize_storage_payload_does_not_expand_custom_task_experiments_to_three() -> None:
    payload = {
        "mes.tasks": [
            {
                "code": "SYLU-2026-04-501",
                "name": "自定义双实验任务",
                "test_type": "盐雾试验 / 振动试验",
                "test_types": ["盐雾试验", "振动试验"],
                "experiment_count": 2,
                "status": "待排程",
            }
        ],
        "mes.experiments": [],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)

    assert normalized["mes.tasks"][0]["experiment_count"] == 2
    assert normalized["mes.tasks"][0]["experiment_codes"] == [
        "SYLU-2026-04-501-A",
        "SYLU-2026-04-501-B",
    ]
    assert [experiment["experiment_name"] for experiment in normalized["mes.experiments"]] == ["盐雾试验", "振动试验"]
    assert normalized["mes.experiments"][1]["axis_codes"] == ["x+", "x-", "y+", "y-", "z+", "z-"]


def test_normalize_storage_payload_applies_task_axis_selection_to_generated_experiments() -> None:
    payload = {
        "mes.tasks": [
            {
                "code": "SYLU-2026-04-503",
                "name": "轴向选择任务",
                "test_type": "冲击试验 / 振动试验 / 盐雾试验",
                "test_types": ["冲击试验", "振动试验", "盐雾试验"],
                "axis_codes_by_test_type": {
                    "冲击试验": ["x+", "z-"],
                    "振动试验": ["y-"],
                    "盐雾试验": ["x-"],
                },
                "status": "待排程",
            }
        ],
        "mes.experiments": [],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)

    assert [experiment.get("axis_codes") for experiment in normalized["mes.experiments"]] == [
        ["x+", "z-"],
        ["y-"],
        None,
    ]


def test_normalize_storage_payload_adds_axis_codes_to_existing_impact_and_vibration_experiments() -> None:
    payload = {
        "mes.tasks": [
            {
                "code": "SYLU-2026-04-502",
                "name": "轴向实验任务",
                "test_type": "冲击试验 / 振动试验",
                "test_types": ["冲击试验", "振动试验"],
                "experiment_codes": ["SYLU-2026-04-502-A", "SYLU-2026-04-502-B"],
                "status": "待排程",
            }
        ],
        "mes.experiments": [
            {
                "task_code": "SYLU-2026-04-502",
                "experiment_code": "SYLU-2026-04-502-A",
                "experiment_name": "冲击试验",
                "required_device": "冲击试验",
            },
            {
                "task_code": "SYLU-2026-04-502",
                "experiment_code": "SYLU-2026-04-502-B",
                "experiment_name": "振动试验",
                "required_device": "振动试验",
                "axis_codes": ["z-", "y+"],
            },
        ],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)

    experiments = normalized["mes.experiments"]
    assert experiments[0]["axis_codes"] == ["x+", "x-", "y+", "y-", "z+", "z-"]
    assert experiments[1]["axis_codes"] == ["y+", "z-"]


def test_normalize_storage_payload_splits_legacy_test_type_without_expanding_to_three() -> None:
    payload = {
        "mes.tasks": [
            {
                "code": "SYLU-2026-04-503",
                "name": "旧双实验任务",
                "test_type": "盐雾试验 / 振动试验",
                "status": "待排程",
            }
        ],
        "mes.experiments": [],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)

    assert normalized["mes.tasks"][0]["experiment_count"] == 2
    assert normalized["mes.tasks"][0]["experiment_codes"] == [
        "SYLU-2026-04-503-A",
        "SYLU-2026-04-503-B",
    ]
    assert [experiment["experiment_name"] for experiment in normalized["mes.experiments"]] == ["盐雾试验", "振动试验"]


def test_normalize_storage_payload_does_not_use_task_name_as_experiment_type() -> None:
    payload = {
        "mes.tasks": [
            {
                "code": "SYLU-2026-04-504",
                "name": "只修改任务名称",
                "experiment_count": 1,
                "status": "待排程",
            }
        ],
        "mes.experiments": [],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)

    assert [experiment["experiment_name"] for experiment in normalized["mes.experiments"]] == ["冲击试验"]


def test_normalize_storage_payload_normalizes_experiment_run_tray_status_and_times() -> None:
    payload = {
        "mes.experiment_run_trays": [
            {
                "run_no": "run-001",
                "task_code": "TASK-001",
                "experiment_code": "TASK-001-A",
                "tray_code": "TP-001",
                "run_tray_status": "实验中",
                "started_at": "2026-06-04T12:00:00Z",
                "updated_at": "2026-06-04T12:05:00Z",
            }
        ],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)

    assert normalized["mes.experiment_run_trays"][0]["run_tray_status"] == "实验进行中"
    assert normalized["mes.experiment_run_trays"][0]["started_at"] == "2026-06-04 20:00:00"
    assert normalized["mes.experiment_run_trays"][0]["updated_at"] == "2026-06-04 20:05:00"


def test_normalize_storage_payload_uses_test_types_over_stale_experiment_count() -> None:
    payload = {
        "mes.tasks": [
            {
                "code": "SYLU-2026-04-502",
                "name": "固定实验类型任务",
                "test_type": "盐雾试验 / 振动试验",
                "test_types": ["盐雾试验", "振动试验"],
                "experiment_count": 5,
                "status": "待排程",
            }
        ],
        "mes.experiments": [],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)

    assert normalized["mes.tasks"][0]["experiment_count"] == 2
    assert normalized["mes.tasks"][0]["experiment_codes"] == [
        "SYLU-2026-04-502-A",
        "SYLU-2026-04-502-B",
    ]
    assert [experiment["experiment_name"] for experiment in normalized["mes.experiments"]] == ["盐雾试验", "振动试验"]


def test_normalize_storage_payload_marks_task_returned_from_staging_events_when_trays_are_reset() -> None:
    payload = {
        "mes.tasks": [
            {
                "code": "SYLU-2026-03-001",
                "name": "已收回任务",
                "status": "待排程",
                "transfer_status": "已入库",
                "experiment_codes": ["SYLU-2026-03-001-A"],
                "experiment_count": 1,
            }
        ],
        "mes.samples": [
            {
                "code": "SYLU-2026-03-001-SP-001",
                "task_code": "SYLU-2026-03-001",
                "status": "已入库",
                "flow_status": "已入库",
                "trays": [],
                "history": [
                    {
                        "action": "暂存间扫码入库",
                        "status": "已到达暂存间",
                        "time": "2026-04-28T03:00:00Z",
                    }
                ],
            },
            {
                "code": "SYLU-2026-03-001-SP-002",
                "task_code": "SYLU-2026-03-001",
                "status": "已入库",
                "flow_status": "已入库",
                "trays": [],
            },
        ],
        "mes.experiments": [
            {
                "task_code": "SYLU-2026-03-001",
                "experiment_code": "SYLU-2026-03-001-A",
                "experiment_name": "盐雾试验",
                "status": "待排程",
            }
        ],
        "mes.experiment_trays": [
            {
                "task_code": "SYLU-2026-03-001",
                "experiment_code": "SYLU-2026-03-001-A",
                "tray_code": "SYLU-2026-03-001-TP-001",
            }
        ],
        "mes.experiment_samples": [
            {
                "task_code": "SYLU-2026-03-001",
                "experiment_code": "SYLU-2026-03-001-A",
                "sample_code": "SYLU-2026-03-001-SP-001",
            },
            {
                "task_code": "SYLU-2026-03-001",
                "experiment_code": "SYLU-2026-03-001-A",
                "sample_code": "SYLU-2026-03-001-SP-002",
            },
        ],
        "mes.staging_events": [
            {
                "tray_code": "SYLU-2026-03-001-TP-001",
                "task_code": "SYLU-2026-03-001",
                "action": "manufacturer_return",
                "time": "2026-04-28T03:32:34Z",
                "target_lab": "厂家收回",
            }
        ],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)

    assert normalized["mes.tasks"][0]["status"] == "厂家收回"
    assert normalized["mes.tasks"][0]["transfer_status"] == "厂家收回"
    assert normalized["mes.samples"][0]["status"] == "已入库"
    assert normalized["mes.samples"][0]["flow_status"] == "已入库"
    assert normalized["mes.samples"][0]["history"][0]["status"] == "已到达暂存间"
    assert normalized["mes.samples"][0]["trays"] == []
    assert normalized["mes.samples"][1]["status"] == "已入库"
    assert normalized["mes.samples"][1]["flow_status"] == "已入库"
    assert normalized["mes.samples"][1]["trays"] == []


def test_normalize_storage_payload_closes_experiment_schedules_when_scoped_trays_are_completed_or_returned() -> None:
    task_code = "SYLU-2026-06-021"
    payload = {
        "mes.tasks": [{"code": task_code, "status": "任务进行中", "transfer_status": "厂家收回"}],
        "mes.experiments": [
            {
                "task_code": task_code,
                "experiment_code": f"{task_code}-A",
                "experiment_name": "冲击试验",
                "status": "实验进行中",
            },
            {
                "task_code": task_code,
                "experiment_code": f"{task_code}-B",
                "experiment_name": "温度冲击试验",
                "status": "实验进行中",
            },
            {
                "task_code": task_code,
                "experiment_code": f"{task_code}-C",
                "experiment_name": "振动试验",
                "status": "实验已完成",
            },
        ],
        "mes.schedules": [
            {"id": "schedule-a", "task_code": task_code, "experiment_code": f"{task_code}-A", "device": "冲击二室", "status": "实验进行中"},
            {"id": "schedule-b", "task_code": task_code, "experiment_code": f"{task_code}-B", "device": "温度冲击二室", "status": "实验进行中"},
            {"id": "schedule-c", "task_code": task_code, "experiment_code": f"{task_code}-C", "device": "振动二室", "status": "实验已完成"},
        ],
        "mes.experiment_trays": [
            {"task_code": task_code, "experiment_code": f"{task_code}-A", "tray_code": f"{task_code}-TP-001"},
            {"task_code": task_code, "experiment_code": f"{task_code}-A", "tray_code": f"{task_code}-TP-003"},
            {"task_code": task_code, "experiment_code": f"{task_code}-A", "tray_code": f"{task_code}-TP-004"},
            {"task_code": task_code, "experiment_code": f"{task_code}-A", "tray_code": f"{task_code}-TP-005"},
            {"task_code": task_code, "experiment_code": f"{task_code}-B", "tray_code": f"{task_code}-TP-001"},
            {"task_code": task_code, "experiment_code": f"{task_code}-B", "tray_code": f"{task_code}-TP-002"},
            {"task_code": task_code, "experiment_code": f"{task_code}-B", "tray_code": f"{task_code}-TP-004"},
            {"task_code": task_code, "experiment_code": f"{task_code}-B", "tray_code": f"{task_code}-TP-005"},
            {"task_code": task_code, "experiment_code": f"{task_code}-C", "tray_code": f"{task_code}-TP-002"},
        ],
        "mes.experiment_run_trays": [
            {"task_code": task_code, "experiment_code": f"{task_code}-A", "tray_code": f"{task_code}-TP-001", "run_tray_status": "实验已完成"},
            {"task_code": task_code, "experiment_code": f"{task_code}-A", "tray_code": f"{task_code}-TP-004", "run_tray_status": "实验已完成"},
            {"task_code": task_code, "experiment_code": f"{task_code}-A", "tray_code": f"{task_code}-TP-005", "run_tray_status": "实验已完成"},
            {"task_code": task_code, "experiment_code": f"{task_code}-B", "tray_code": f"{task_code}-TP-001", "run_tray_status": "实验已完成"},
            {"task_code": task_code, "experiment_code": f"{task_code}-B", "tray_code": f"{task_code}-TP-002", "run_tray_status": "实验已完成"},
            {"task_code": task_code, "experiment_code": f"{task_code}-B", "tray_code": f"{task_code}-TP-005", "run_tray_status": "实验已完成"},
        ],
        "mes.samples": [
            {
                "code": f"{task_code}-SP-{index:03d}",
                "task_code": task_code,
                "status": "厂家收回",
                "flow_status": "厂家收回",
                "location": "厂家收回",
                "trays": [{"tray_code": f"{task_code}-TP-{index:03d}", "status": "厂家收回"}],
            }
            for index in range(1, 6)
        ],
        "mes.staging_events": [
            {
                "action": "manufacturer_return",
                "task_code": task_code,
                "target_lab": "厂家收回",
                "time": f"2026-06-05 18:29:{10 + index:02d}",
                "tray_code": f"{task_code}-TP-{index:03d}",
            }
            for index in range(1, 6)
        ],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)

    assert [schedule["id"] for schedule in normalized["mes.schedules"]] == []
    assert {
        experiment["experiment_code"]: experiment["status"]
        for experiment in normalized["mes.experiments"]
    } == {
        f"{task_code}-A": "实验已完成",
        f"{task_code}-B": "实验已完成",
        f"{task_code}-C": "实验已完成",
    }
    returned_run_trays = {
        (relation["experiment_code"], relation["tray_code"], relation["run_tray_status"])
        for relation in normalized["mes.experiment_run_trays"]
        if relation.get("run_tray_status") == "厂家收回"
    }
    assert returned_run_trays >= {
        (f"{task_code}-A", f"{task_code}-TP-003", "厂家收回"),
        (f"{task_code}-B", f"{task_code}-TP-004", "厂家收回"),
    }
    assert all(
        relation.get("run_no")
        for relation in normalized["mes.experiment_run_trays"]
        if relation.get("run_tray_status") == "厂家收回"
    )


def test_normalize_storage_payload_marks_returned_tray_terminal_for_unfinished_future_experiments() -> None:
    task_code = "SYLU-2026-06-021"
    tray_code = f"{task_code}-TP-002"
    payload = {
        "mes.tasks": [{"code": task_code, "status": "任务进行中"}],
        "mes.experiments": [
            {
                "task_code": task_code,
                "experiment_code": f"{task_code}-A",
                "experiment_name": "冲击试验",
                "status": "实验已完成",
            },
            {
                "task_code": task_code,
                "experiment_code": f"{task_code}-B",
                "experiment_name": "温度冲击试验",
                "status": "实验进行中",
            },
        ],
        "mes.schedules": [
            {"id": "schedule-b", "task_code": task_code, "experiment_code": f"{task_code}-B", "device": "温度冲击二室", "status": "实验进行中"},
        ],
        "mes.experiment_trays": [
            {"task_code": task_code, "experiment_code": f"{task_code}-A", "tray_code": tray_code},
            {"task_code": task_code, "experiment_code": f"{task_code}-B", "tray_code": tray_code},
            {"task_code": task_code, "experiment_code": f"{task_code}-B", "tray_code": f"{task_code}-TP-005"},
        ],
        "mes.experiment_run_trays": [
            {
                "run_no": "RUN-IMPACT-002",
                "task_code": task_code,
                "experiment_code": f"{task_code}-A",
                "tray_code": tray_code,
                "run_tray_status": "实验已完成",
            },
            {
                "run_no": "RUN-TEMP-005",
                "task_code": task_code,
                "experiment_code": f"{task_code}-B",
                "tray_code": f"{task_code}-TP-005",
                "run_tray_status": "实验进行中",
            },
        ],
        "mes.samples": [
            {
                "code": f"{task_code}-SP-002",
                "task_code": task_code,
                "status": "厂家收回",
                "flow_status": "厂家收回",
                "location": "厂家收回",
                "trays": [{"tray_code": tray_code, "status": "厂家收回"}],
            }
        ],
        "mes.staging_events": [
            {
                "action": "manufacturer_return",
                "task_code": task_code,
                "target_lab": "厂家收回",
                "time": "2026-06-06 12:58:34",
                "tray_code": tray_code,
            }
        ],
    }

    normalized = normalize_storage_payload(payload)

    assert [schedule["id"] for schedule in normalized["mes.schedules"]] == ["schedule-b"]
    assert {
        (relation["experiment_code"], relation["tray_code"], relation["run_tray_status"])
        for relation in normalized["mes.experiment_run_trays"]
    } >= {
        (f"{task_code}-B", tray_code, "厂家收回"),
    }


def test_normalize_storage_payload_preserves_unfinished_axis_schedule_when_returned_tray_completed_only_one_batch() -> None:
    task_code = "SYLU-2026-08-002"
    experiment_code = f"{task_code}-A"
    tray_one = f"{task_code}-TP-001"
    tray_two = f"{task_code}-TP-002"
    first_sub_code = f"{experiment_code}-AXIS-001"
    second_sub_code = f"{experiment_code}-AXIS-002"
    payload = {
        "mes.tasks": [{"code": task_code, "status": "任务进行中"}],
        "mes.experiments": [
            {
                "axis_codes": ["x+", "x-", "y+", "y-", "z+", "z-"],
                "experiment_code": experiment_code,
                "experiment_name": "冲击试验",
                "status": "实验进行中",
                "task_code": task_code,
            }
        ],
        "mes.schedules": [
            {
                "axis_codes": ["x+", "x-", "y+"],
                "experiment_code": experiment_code,
                "id": "schedule-impact-axis-001",
                "status": "实验已完成",
                "sub_experiment_code": first_sub_code,
                "task_code": task_code,
            },
            {
                "axis_codes": ["y-", "z+", "z-"],
                "experiment_code": experiment_code,
                "id": "schedule-impact-axis-002",
                "status": "已排程",
                "sub_experiment_code": second_sub_code,
                "task_code": task_code,
            },
        ],
        "mes.experiment_trays": [
            {"experiment_code": experiment_code, "task_code": task_code, "tray_code": tray_one},
            {"experiment_code": experiment_code, "task_code": task_code, "tray_code": tray_two},
        ],
        "mes.experiment_run_trays": [
            {
                "experiment_code": experiment_code,
                "run_no": "RUN-TP1-AXIS-001",
                "run_tray_status": "实验已完成",
                "sub_experiment_code": first_sub_code,
                "task_code": task_code,
                "tray_code": tray_one,
            },
            {
                "experiment_code": experiment_code,
                "run_no": "RUN-TP1-AXIS-002",
                "run_tray_status": "实验已完成",
                "sub_experiment_code": second_sub_code,
                "task_code": task_code,
                "tray_code": tray_one,
            },
            {
                "experiment_code": experiment_code,
                "run_no": "RUN-TP2-AXIS-001",
                "run_tray_status": "实验已完成",
                "sub_experiment_code": first_sub_code,
                "task_code": task_code,
                "tray_code": tray_two,
            },
        ],
        "mes.samples": [
            {
                "code": f"{task_code}-SP-001",
                "location": "厂家收回",
                "status": "厂家收回",
                "task_code": task_code,
                "trays": [{"status": "厂家收回", "tray_code": tray_one}],
            },
            {
                "code": f"{task_code}-SP-002",
                "location": "冲击一室",
                "status": "冲击试验部分完成 3/6轴",
                "task_code": task_code,
                "trays": [{"status": "冲击试验部分完成 3/6轴", "tray_code": tray_two}],
            },
        ],
        "mes.staging_events": [
            {
                "action": "manufacturer_return",
                "target_lab": "厂家收回",
                "task_code": task_code,
                "time": "2026-06-30 17:51:00",
                "tray_code": tray_one,
            },
        ],
    }

    normalized = normalize_storage_payload(payload)

    assert [schedule["id"] for schedule in normalized["mes.schedules"]] == [
        "schedule-impact-axis-001",
        "schedule-impact-axis-002",
    ]
    assert {
        schedule["id"]: schedule["status"]
        for schedule in normalized["mes.schedules"]
    } == {
        "schedule-impact-axis-001": "实验已完成",
        "schedule-impact-axis-002": "已排程",
    }
    assert normalized["mes.experiments"][0]["status"] == "实验进行中"


def test_normalize_storage_payload_infers_returned_tray_task_from_experiment_relations() -> None:
    task_code = "SYLU-2026-06-021"
    tray_code = f"{task_code}-TP-001"
    payload = {
        "mes.tasks": [{"code": task_code, "status": "任务进行中"}],
        "mes.experiments": [
            {
                "task_code": task_code,
                "experiment_code": f"{task_code}-A",
                "experiment_name": "冲击试验",
                "status": "实验已完成",
            },
            {
                "task_code": task_code,
                "experiment_code": f"{task_code}-B",
                "experiment_name": "温度冲击试验",
                "status": "实验进行中",
            },
        ],
        "mes.schedules": [
            {"id": "schedule-b", "task_code": task_code, "experiment_code": f"{task_code}-B", "device": "温度冲击二室", "status": "实验进行中"},
        ],
        "mes.experiment_trays": [
            {"task_code": task_code, "experiment_code": f"{task_code}-A", "tray_code": tray_code},
            {"task_code": task_code, "experiment_code": f"{task_code}-B", "tray_code": tray_code},
            {"task_code": task_code, "experiment_code": f"{task_code}-B", "tray_code": f"{task_code}-TP-005"},
        ],
        "mes.experiment_run_trays": [
            {
                "run_no": "RUN-IMPACT-001",
                "task_code": task_code,
                "experiment_code": f"{task_code}-A",
                "tray_code": tray_code,
                "run_tray_status": "实验已完成",
            },
            {
                "run_no": "STALE-TEMP-001",
                "task_code": task_code,
                "experiment_code": f"{task_code}-B",
                "tray_code": tray_code,
                "run_tray_status": "实验进行中",
            },
        ],
        "mes.samples": [
            {
                "code": f"{task_code}-SP-001",
                "task_code": task_code,
                "status": "厂家收回",
                "flow_status": "厂家收回",
                "location": "厂家收回",
                "trays": [{"tray_code": tray_code, "status": "厂家收回"}],
            }
        ],
        "mes.staging_events": [
            {
                "action": "manufacturer_return",
                "target_lab": "厂家收回",
                "time": "2026-06-06 13:18:16",
                "tray_code": tray_code,
            }
        ],
    }

    normalized = normalize_storage_payload(payload)

    assert {
        (relation["experiment_code"], relation["tray_code"], relation["run_tray_status"])
        for relation in normalized["mes.experiment_run_trays"]
    } >= {
        (f"{task_code}-B", tray_code, "厂家收回"),
    }
    assert [schedule["id"] for schedule in normalized["mes.schedules"]] == ["schedule-b"]


def test_normalize_storage_payload_closes_running_schedules_when_return_events_omit_task_code() -> None:
    task_code = "SYLU-2026-06-021"
    tray_codes = [f"{task_code}-TP-{index:03d}" for index in range(1, 4)]
    payload = {
        "mes.tasks": [{"code": task_code, "status": "任务进行中", "transfer_status": "厂家收回"}],
        "mes.experiments": [
            {"task_code": task_code, "experiment_code": f"{task_code}-A", "experiment_name": "冲击试验", "status": "实验已完成"},
            {"task_code": task_code, "experiment_code": f"{task_code}-B", "experiment_name": "温度冲击试验", "status": "实验进行中"},
            {"task_code": task_code, "experiment_code": f"{task_code}-C", "experiment_name": "振动试验", "status": "实验进行中"},
        ],
        "mes.schedules": [
            {"id": "schedule-b", "task_code": task_code, "experiment_code": f"{task_code}-B", "device": "温度冲击二室", "status": "实验进行中"},
            {"id": "schedule-c", "task_code": task_code, "experiment_code": f"{task_code}-C", "device": "振动二室", "status": "实验进行中"},
        ],
        "mes.experiment_trays": [
            {"task_code": task_code, "experiment_code": experiment_code, "tray_code": tray_code}
            for experiment_code in [f"{task_code}-A", f"{task_code}-B", f"{task_code}-C"]
            for tray_code in tray_codes
        ],
        "mes.experiment_run_trays": [
            {"run_no": "RUN-A-001", "task_code": task_code, "experiment_code": f"{task_code}-A", "tray_code": tray_codes[0], "run_tray_status": "实验已完成"},
            {"run_no": "RUN-A-003", "task_code": task_code, "experiment_code": f"{task_code}-A", "tray_code": tray_codes[2], "run_tray_status": "实验已完成"},
            {"run_no": "RETURNED-A", "task_code": task_code, "experiment_code": f"{task_code}-A", "tray_code": tray_codes[1], "run_tray_status": "厂家收回"},
            {"run_no": "RETURNED-B", "task_code": task_code, "experiment_code": f"{task_code}-B", "tray_code": tray_codes[1], "run_tray_status": "厂家收回"},
            {"run_no": "RETURNED-C", "task_code": task_code, "experiment_code": f"{task_code}-C", "tray_code": tray_codes[1], "run_tray_status": "厂家收回"},
        ],
        "mes.samples": [
            {
                "code": f"{task_code}-SP-{index:03d}",
                "task_code": task_code,
                "status": "厂家收回",
                "flow_status": "厂家收回",
                "location": "厂家收回",
                "trays": [{"tray_code": tray_code, "status": "厂家收回"}],
            }
            for index, tray_code in enumerate(tray_codes, start=1)
        ],
        "mes.staging_events": [
            {
                "action": "manufacturer_return",
                "target_lab": "厂家收回",
                "time": f"2026-06-06 13:18:{10 + index:02d}",
                "tray_code": tray_code,
            }
            for index, tray_code in enumerate(tray_codes, start=1)
        ],
    }

    normalized = normalize_storage_payload(payload)

    assert normalized["mes.schedules"] == []
    assert {
        experiment["experiment_code"]: experiment["status"]
        for experiment in normalized["mes.experiments"]
    } == {
        f"{task_code}-A": "实验已完成",
        f"{task_code}-B": "实验已完成",
        f"{task_code}-C": "实验已完成",
    }
    assert {
        (relation["experiment_code"], relation["tray_code"], relation["run_tray_status"])
        for relation in normalized["mes.experiment_run_trays"]
    } >= {
        (f"{task_code}-B", tray_codes[0], "厂家收回"),
        (f"{task_code}-B", tray_codes[2], "厂家收回"),
        (f"{task_code}-C", tray_codes[0], "厂家收回"),
        (f"{task_code}-C", tray_codes[2], "厂家收回"),
    }


def test_normalize_storage_payload_preserves_legacy_handover_stored_status_without_arrival_conversion() -> None:
    payload = {
        "mes.tasks": [
            {
                "code": "SYLU-2026-05-001",
                "status": "待排程",
                "transfer_status": "已入库",
            }
        ],
        "mes.samples": [
            {
                "code": "SYLU-2026-05-001-SP-001",
                "task_code": "SYLU-2026-05-001",
                "status": "已入库",
                "flow_status": "已入库",
                "trays": [{"tray_code": "SYLU-2026-05-001-TP-001", "status": "已入库"}],
                "history": [{"action": "任务已确认入库", "status": "已入库"}],
            }
        ],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)

    assert normalized["mes.tasks"][0]["transfer_status"] == "已入库"
    assert normalized["mes.samples"][0]["status"] == "已入库"
    assert normalized["mes.samples"][0]["flow_status"] == "已入库"
    assert normalized["mes.samples"][0]["trays"][0]["status"] == "已入库"
    assert normalized["mes.samples"][0]["history"][0]["status"] == "已入库"


def test_normalize_storage_payload_keeps_returned_task_archived_even_if_legacy_stock_in_followed() -> None:
    payload = {
        "mes.tasks": [
            {
                "code": "SYLU-2026-03-001",
                "name": "已收回任务",
                "sample_count": 1,
                "test_types": ["盐雾试验"],
            }
        ],
        "mes.samples": [
            {
                "code": "SYLU-2026-03-001-SP-001",
                "task_code": "SYLU-2026-03-001",
                "status": "已到达暂存间",
                "flow_status": "已到达暂存间",
                "location": "恒温恒湿间（暂存间）",
                "trays": [
                    {
                        "tray_code": "SYLU-2026-03-001-TP-001",
                        "status": "已到达暂存间",
                    }
                ],
            }
        ],
        "mes.experiments": [
            {
                "task_code": "SYLU-2026-03-001",
                "experiment_code": "SYLU-2026-03-001-A",
                "experiment_name": "盐雾试验",
                "status": "待排程",
            }
        ],
        "mes.experiment_trays": [
            {
                "task_code": "SYLU-2026-03-001",
                "experiment_code": "SYLU-2026-03-001-A",
                "tray_code": "SYLU-2026-03-001-TP-001",
            }
        ],
        "mes.staging_events": [
            {
                "tray_code": "SYLU-2026-03-001-TP-001",
                "task_code": "SYLU-2026-03-001",
                "action": "manufacturer_return",
                "time": "2026-04-28T03:32:34Z",
                "target_lab": "厂家收回",
            },
            {
                "tray_code": "SYLU-2026-03-001-TP-001",
                "task_code": "SYLU-2026-03-001",
                "action": "stock_in",
                "time": "2026-04-28T03:40:00Z",
            },
        ],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)

    assert normalized["mes.tasks"][0]["status"] == "厂家收回"
    assert normalized["mes.tasks"][0]["transfer_status"] == "厂家收回"
    assert normalized["mes.samples"][0]["status"] == "厂家收回"
    assert normalized["mes.samples"][0]["flow_status"] == "厂家收回"
    assert normalized["mes.samples"][0]["trays"][0]["status"] == "厂家收回"
    assert normalized["mes.samples"][0]["trays"][0]["updated_at"] == "2026-04-28 11:32:34"


def test_normalize_storage_payload_does_not_use_legacy_sample_tray_return_for_multi_experiment_task() -> None:
    task_code = "SYLU-2026-06-099"
    payload = {
        "mes.tasks": [
            {
                "code": task_code,
                "name": "多实验旧样品状态",
                "status": "任务进行中",
                "transfer_status": "已入库",
                "experiment_codes": [f"{task_code}-A", f"{task_code}-B"],
                "experiment_count": 2,
            }
        ],
        "mes.samples": [
            {
                "code": f"{task_code}-SP-001",
                "task_code": task_code,
                "status": "实验进行中",
                "flow_status": "实验进行中",
                "location": "温度冲击二室",
                "trays": [
                    {
                        "tray_code": f"{task_code}-TP-001",
                        "status": "实验进行中",
                    }
                ],
            }
        ],
        "mes.experiments": [
            {
                "task_code": task_code,
                "experiment_code": f"{task_code}-A",
                "experiment_name": "盐雾试验",
                "status": "实验进行中",
            },
            {
                "task_code": task_code,
                "experiment_code": f"{task_code}-B",
                "experiment_name": "振动试验",
                "status": "待排程",
            },
        ],
        "mes.staging_events": [
            {
                "tray_code": f"{task_code}-TP-001",
                "task_code": task_code,
                "action": "manufacturer_return",
                "time": "2026-06-06 15:20:00",
                "target_lab": "厂家收回",
            }
        ],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)

    assert normalized["mes.tasks"][0]["status"] == "任务进行中"
    assert normalized["mes.tasks"][0]["transfer_status"] == "已入库"
    assert normalized["mes.samples"][0]["status"] == "实验进行中"
    assert normalized["mes.samples"][0]["flow_status"] == "实验进行中"
    assert normalized["mes.samples"][0]["location"] == "温度冲击二室"
    assert normalized["mes.samples"][0]["trays"][0]["status"] == "实验进行中"


def test_normalize_storage_payload_rejects_legacy_sample_tray_return_for_single_experiment_single_tray() -> None:
    task_code = "SYLU-2026-06-100"
    tray_code = f"{task_code}-TP-001"
    payload = {
        "mes.tasks": [
            {
                "code": task_code,
                "status": "待排程",
                "transfer_status": "已入库",
                "experiment_codes": [f"{task_code}-A"],
                "experiment_count": 1,
            }
        ],
        "mes.samples": [
            {
                "code": f"{task_code}-SP-001",
                "task_code": task_code,
                "status": "已到达暂存间",
                "flow_status": "已到达暂存间",
                "trays": [{"tray_code": tray_code, "status": "已到达暂存间"}],
            }
        ],
        "mes.experiments": [
            {
                "task_code": task_code,
                "experiment_code": f"{task_code}-A",
                "experiment_name": "盐雾试验",
                "status": "待排程",
            }
        ],
        "mes.staging_events": [
            {
                "tray_code": tray_code,
                "task_code": task_code,
                "action": "manufacturer_return",
                "time": "2026-06-06 15:30:00",
                "target_lab": "厂家收回",
            }
        ],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)

    assert normalized["mes.tasks"][0]["status"] == "待排程"
    assert normalized["mes.tasks"][0]["transfer_status"] == "已入库"
    assert normalized["mes.samples"][0]["status"] == "已到达暂存间"
    assert normalized["mes.samples"][0]["flow_status"] == "已到达暂存间"
    assert normalized["mes.samples"][0]["trays"][0]["status"] == "已到达暂存间"


def test_normalize_storage_payload_does_not_return_unmapped_legacy_sample_when_structured_relation_exists() -> None:
    task_code = "SYLU-2026-06-101"
    returned_tray_code = f"{task_code}-TP-001"
    unmapped_tray_code = f"{task_code}-TP-002"
    payload = {
        "mes.tasks": [
            {
                "code": task_code,
                "status": "任务进行中",
                "transfer_status": "已入库",
                "experiment_codes": [f"{task_code}-A"],
                "experiment_count": 1,
            }
        ],
        "mes.samples": [
            {
                "code": f"{task_code}-SP-001",
                "task_code": task_code,
                "status": "已到达暂存间",
                "flow_status": "已到达暂存间",
                "trays": [{"tray_code": returned_tray_code, "status": "已到达暂存间"}],
            },
            {
                "code": f"{task_code}-SP-002",
                "task_code": task_code,
                "status": "实验进行中",
                "flow_status": "实验进行中",
                "location": "温度冲击二室",
                "trays": [{"tray_code": unmapped_tray_code, "status": "实验进行中"}],
            },
        ],
        "mes.experiment_trays": [
            {
                "task_code": task_code,
                "experiment_code": f"{task_code}-A",
                "tray_code": returned_tray_code,
            }
        ],
        "mes.staging_events": [
            {
                "tray_code": returned_tray_code,
                "task_code": task_code,
                "action": "manufacturer_return",
                "time": "2026-06-06 15:40:00",
                "target_lab": "厂家收回",
            }
        ],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)
    samples = {sample["code"]: sample for sample in normalized["mes.samples"]}

    assert samples[f"{task_code}-SP-001"]["status"] == "厂家收回"
    assert samples[f"{task_code}-SP-001"]["trays"][0]["status"] == "厂家收回"
    assert samples[f"{task_code}-SP-002"]["status"] == "实验进行中"
    assert samples[f"{task_code}-SP-002"]["flow_status"] == "实验进行中"
    assert samples[f"{task_code}-SP-002"]["location"] == "温度冲击二室"
    assert samples[f"{task_code}-SP-002"]["trays"][0]["status"] == "实验进行中"


def test_normalize_storage_payload_keeps_other_task_trays_active_when_one_tray_returned() -> None:
    payload = {
        "mes.tasks": [
            {
                "code": "SYLU-2026-03-002",
                "name": "部分收回任务",
                "sample_count": 2,
                "test_types": ["盐雾试验"],
            }
        ],
        "mes.samples": [
            {
                "code": "SYLU-2026-03-002-SP-001",
                "task_code": "SYLU-2026-03-002",
                "status": "已到达暂存间",
                "flow_status": "已到达暂存间",
                "location": "恒温恒湿间（暂存间）",
                "trays": [{"tray_code": "SYLU-2026-03-002-TP-001", "status": "已到达暂存间"}],
            },
            {
                "code": "SYLU-2026-03-002-SP-002",
                "task_code": "SYLU-2026-03-002",
                "status": "送至暂存间",
                "flow_status": "送至暂存间",
                "location": "恒温恒湿间（暂存间）",
                "trays": [{"tray_code": "SYLU-2026-03-002-TP-002", "status": "送至暂存间"}],
            },
        ],
        "mes.experiment_trays": [
            {
                "task_code": "SYLU-2026-03-002",
                "experiment_code": "SYLU-2026-03-002-A",
                "tray_code": "SYLU-2026-03-002-TP-001",
            },
            {
                "task_code": "SYLU-2026-03-002",
                "experiment_code": "SYLU-2026-03-002-A",
                "tray_code": "SYLU-2026-03-002-TP-002",
            },
        ],
        "mes.staging_events": [
            {
                "tray_code": "SYLU-2026-03-002-TP-001",
                "task_code": "SYLU-2026-03-002",
                "action": "manufacturer_return",
                "time": "2026-04-28T03:32:34Z",
                "target_lab": "厂家收回",
            }
        ],
        "mes.meta": {"schema_version": 2},
    }

    normalized = normalize_storage_payload(payload)

    assert normalized["mes.tasks"][0].get("transfer_status") != "厂家收回"
    assert normalized["mes.samples"][0]["trays"][0]["status"] == "已到达暂存间"
    assert normalized["mes.samples"][1]["status"] == "送至暂存间"
    assert normalized["mes.samples"][1]["trays"][0]["status"] == "送至暂存间"


def test_reset_demo_data_resets_backend_snapshot_with_fresh_tasks_and_preserves_devices() -> None:
    writes = {}

    class _DummyStorage:
        def read_all(self):
            return {
                "mes.tasks": [{"code": "SYLU-2026-03-999", "name": "旧任务"}],
                "mes.samples": [{"code": "SYLU-2026-03-999-SP-001", "task_code": "SYLU-2026-03-999"}],
                "mes.experiments": [{"experiment_code": "SYLU-2026-03-999-A", "task_code": "SYLU-2026-03-999"}],
                "mes.schedules": [{"task_code": "SYLU-2026-03-999", "experiment_code": "SYLU-2026-03-999-A"}],
                "mes.experiment_trays": [{"task_code": "SYLU-2026-03-999", "experiment_code": "SYLU-2026-03-999-A", "tray_code": "SYLU-2026-03-999-TP-001"}],
                "mes.experiment_samples": [{"task_code": "SYLU-2026-03-999", "experiment_code": "SYLU-2026-03-999-A", "sample_code": "SYLU-2026-03-999-SP-001"}],
                "mes.experiment_runs": [{"run_no": "RUN-OLD", "task_code": "SYLU-2026-03-999", "experiment_code": "SYLU-2026-03-999-A"}],
                "mes.experiment_run_trays": [{"run_no": "RUN-OLD", "task_code": "SYLU-2026-03-999", "experiment_code": "SYLU-2026-03-999-A", "tray_code": "SYLU-2026-03-999-TP-001"}],
                "mes.experiment_run_steps": [{"run_no": "RUN-OLD", "task_code": "SYLU-2026-03-999", "experiment_code": "SYLU-2026-03-999-A", "axis_code": "x+"}],
                "mes.staging_events": [{"id": "EVENT-OLD", "task_code": "SYLU-2026-03-999", "tray_code": "SYLU-2026-03-999-TP-001"}],
                "mes.streams": [{"task_code": "SYLU-2026-03-999", "status": "采集中"}],
                "mes.conflicts": [{"task_code": "SYLU-2026-03-999"}],
                "mes.devices": [
                    {
                        "id": "device-1",
                        "code": "LAB-001",
                        "maintenance_end_at": "2026-07-12 18:00",
                        "maintenance_note": "年度维修",
                        "maintenance_start_at": "2026-07-11 08:00",
                        "maintenance_type": "计划维修",
                        "name": "振动一室",
                        "status": "维修",
                    }
                ],
                "mes.meta": {"schema_version": 2},
            }

        def write_many(self, updates):
            writes.update(updates)

    snapshot = reset_demo_data(_DummyStorage())

    assert [{key: value for key, value in device.items() if key != "next_cal"} for device in snapshot["mes.devices"]] == [
        {
            "id": "device-1",
            "code": "LAB-001",
            "maintenance_end_at": "",
            "maintenance_note": "",
            "maintenance_start_at": "",
            "maintenance_type": "",
            "name": "振动一室",
            "status": "可用",
        }
    ]
    next_calibration_date = datetime.strptime(snapshot["mes.devices"][0]["next_cal"], "%Y-%m-%d").date()
    reset_date = datetime.now().date()
    assert reset_date + timedelta(days=30) <= next_calibration_date <= reset_date + timedelta(days=60)
    assert len(snapshot["mes.tasks"]) == 20
    assert all("盐雾试验" in str(task["test_type"]).split(" / ") for task in snapshot["mes.tasks"])
    assert snapshot["mes.schedules"] == []
    assert snapshot["mes.experiment_trays"] == []
    assert snapshot["mes.experiment_samples"] == []
    assert snapshot["mes.experiment_runs"] == []
    assert snapshot["mes.experiment_run_trays"] == []
    assert snapshot["mes.experiment_run_steps"] == []
    assert snapshot["mes.staging_events"] == []
    assert snapshot["mes.streams"] == []
    assert snapshot["mes.conflicts"] == []
    assert all(sample["status"] == "运输中" and sample["flow_status"] == "运输中" for sample in snapshot["mes.samples"])
    assert all(experiment["status"] == "待排程" for experiment in snapshot["mes.experiments"])
    assert writes["mes.devices"] == snapshot["mes.devices"]
    assert writes["mes.experiment_run_trays"] == []
    assert writes["mes.experiment_run_steps"] == []
    assert writes["mes.staging_events"] == []
    today = datetime.now()
    assert writes["mes.tasks"][0]["code"] == f"SYLU-{today.year}-{today.month:02d}-001"


def test_run_demo_reset_returns_summary_counts() -> None:
    class _DummyStorage:
        def read_all(self):
            return {
                "mes.devices": [{"id": "device-1", "code": "LAB-001", "name": "振动一室"}],
                "mes.meta": {"schema_version": 2},
            }

        def write_many(self, updates):
            return None

    summary = run_demo_reset(_DummyStorage())

    assert summary["task_count"] == 20
    assert summary["experiment_count"] == 60
    assert summary["sample_count"] > 100


def test_reset_demo_script_resets_mysql_only(monkeypatch, capsys) -> None:
    module = importlib.import_module("scripts.reset_demo_data")
    captured = {}

    monkeypatch.setattr(module, "initialize_mysql_storage", lambda seed_demo=False: captured.update({"seed_demo": seed_demo}))
    monkeypatch.setattr(module, "create_mysql_storage_backend", lambda: "backend")
    monkeypatch.setattr(
        module,
        "run_demo_reset",
        lambda backend: captured.update({"backend": backend}) or {
            "task_count": 20,
            "sample_count": 160,
            "experiment_count": 60,
        },
    )

    exit_code = module.main([])

    assert exit_code == 0
    assert captured == {"seed_demo": False, "backend": "backend"}
    assert "json_snapshot" not in capsys.readouterr().out


def test_init_mysql_storage_script_initializes_schema_without_demo_seed_by_default(monkeypatch, capsys) -> None:
    module = importlib.import_module("scripts.init_mysql_storage")
    captured = {}

    monkeypatch.setattr(
        module,
        "initialize_mysql_storage",
        lambda seed_demo=False: captured.update({"seed_demo": seed_demo}) or {
            "database": "mes",
            "schema_initialized": True,
            "demo_seeded": False,
            "task_count": 0,
        },
    )

    exit_code = module.main([])

    assert exit_code == 0
    assert captured == {"seed_demo": False}
    assert "demo_seeded=no" in capsys.readouterr().out


def test_initialize_mysql_storage_uses_migration_connection_without_loading_runtime_backend(monkeypatch) -> None:
    module = importlib.import_module("scripts.init_mysql_storage")
    touched = []

    class _Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, sql):
            touched.append("count_tasks")

        def fetchone(self):
            return (0,)

    class _Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def cursor(self):
            return _Cursor()

    monkeypatch.setattr(module, "ensure_database_exists", lambda: touched.append("ensure_database"))
    monkeypatch.setattr(
        module,
        "apply_pending_schema_migrations",
        lambda: touched.append("apply_pending_schema_migrations") or ["V001", "V002"],
    )
    monkeypatch.setattr(
        module,
        "validate_required_schema_tables_exist",
        lambda: touched.append("validate_required_schema_tables"),
    )
    monkeypatch.setattr(module, "_connect_mysql", lambda **_kwargs: _Connection())
    monkeypatch.setattr(
        module,
        "create_mysql_storage_backend",
        lambda: (_ for _ in ()).throw(AssertionError("runtime backend must not be loaded")),
    )

    summary = module.initialize_mysql_storage(seed_demo=False)

    assert touched == [
        "ensure_database",
        "apply_pending_schema_migrations",
        "validate_required_schema_tables",
        "count_tasks",
    ]
    assert summary["schema_initialized"] is True
    assert summary["applied_migrations"] == ["V001", "V002"]
    assert summary["task_count"] == 0


def test_initialize_mysql_storage_validates_schema_only_after_migrations_are_applied(monkeypatch) -> None:
    module = importlib.import_module("scripts.init_mysql_storage")
    touched = []

    monkeypatch.setattr(module, "ensure_database_exists", lambda: None)
    monkeypatch.setattr(
        module,
        "apply_pending_schema_migrations",
        lambda: touched.append("migrations") or ["V001", "V002", "V003", "V004", "V005"],
    )

    def _validate_after_migrations() -> None:
        assert touched == ["migrations"]
        touched.append("validation")

    monkeypatch.setattr(
        module,
        "validate_required_schema_tables_exist",
        _validate_after_migrations,
    )
    class _Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, _sql):
            return None

        def fetchone(self):
            return (0,)

    class _Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def cursor(self):
            return _Cursor()

    monkeypatch.setattr(module, "_connect_mysql", lambda **_kwargs: _Connection())

    summary = module.initialize_mysql_storage(seed_demo=False)

    assert touched == ["migrations", "validation"]
    assert summary["schema_initialized"] is True
    assert summary["schema_version"] == "V005"


def test_initialize_mysql_storage_forbids_demo_seed_in_production(monkeypatch) -> None:
    module = importlib.import_module("scripts.init_mysql_storage")
    monkeypatch.setattr(module.settings, "APP_ENV", "prod")
    monkeypatch.setattr(
        module,
        "ensure_database_exists",
        lambda: (_ for _ in ()).throw(AssertionError("database must not be touched")),
    )

    with pytest.raises(RuntimeError, match="seed-demo is forbidden"):
        module.initialize_mysql_storage(seed_demo=True)


def test_init_mysql_storage_schema_order_starts_with_complete_baseline() -> None:
    module = importlib.import_module("scripts.init_mysql_storage")

    schema_names = [path.name for path in module.iter_schema_sql_paths()]

    assert schema_names == [
        "0001-complete-baseline-schema.sql",
        "2026-03-17-app-storage-snapshot.sql",
        "2026-03-17-mes-single-branch-schema-alignment.sql",
        "V004__runtime_schema_finalization.sql",
        "V005__terminal_collation_alignment.sql",
    ]


def test_init_mysql_storage_validates_full_schema_including_experiment_run_tables(monkeypatch) -> None:
    module = importlib.import_module("scripts.init_mysql_storage")
    representative_table = "biz_experiment_run"

    assert len(module.REQUIRED_SCHEMA_TABLES) == 39
    assert representative_table in module.REQUIRED_SCHEMA_TABLES
    monkeypatch.setattr(module, "find_missing_schema_tables", lambda: [representative_table])

    with pytest.raises(RuntimeError, match=representative_table):
        module.validate_required_schema_tables_exist()


def test_storage_health_report_has_mysql_only_fields(monkeypatch) -> None:
    monkeypatch.setattr(storage_backend_module.settings, "STORAGE_BACKEND", "mysql")
    storage_backend_module._storage_backend = None
    monkeypatch.setattr(
        storage_backend_module,
        "check_mysql_storage_connection",
        lambda: {"status": "ok", "result": 1},
    )

    report = storage_backend_module.get_storage_health_report()

    assert report == {
        "status": "ok",
        "configured_backend": "mysql",
        "active_backend": None,
        "database": {"status": "ok", "result": 1},
        "mysql": {"status": "ok", "result": 1},
    }


def test_storage_health_report_marks_mysql_unhealthy_when_connection_check_fails(monkeypatch) -> None:
    monkeypatch.setattr(storage_backend_module.settings, "STORAGE_BACKEND", "mysql")
    storage_backend_module._storage_backend = None
    monkeypatch.setattr(
        storage_backend_module,
        "check_mysql_storage_connection",
        lambda: {
            "status": "unhealthy",
            "detail": "pymysql is required for the MySQL storage backend",
        },
    )

    report = storage_backend_module.get_storage_health_report()

    assert report["status"] == "unhealthy"
    assert report["configured_backend"] == "mysql"
    assert report["active_backend"] is None
    assert report["database"] == {
        "status": "unhealthy",
        "detail": "pymysql is required for the MySQL storage backend",
    }
    assert report["mysql"] == {
        "status": "unhealthy",
        "detail": "pymysql is required for the MySQL storage backend",
    }


def test_get_storage_backend_rejects_non_mysql_runtime_mode(monkeypatch) -> None:
    monkeypatch.setattr(storage_backend_module.settings, "STORAGE_BACKEND", "json")
    storage_backend_module._storage_backend = None

    with pytest.raises(RuntimeError, match="Only mysql runtime storage is supported"):
        storage_backend_module.get_storage_backend()


def test_check_mysql_storage_connection_uses_short_timeouts(monkeypatch) -> None:
    captured = {}

    class _FakeCursor:
        def execute(self, sql):
            captured["sql"] = sql

        def fetchone(self):
            return (1,)

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    class _FakeConnection:
        def cursor(self):
            return _FakeCursor()

        def close(self):
            captured["closed"] = True

    class _FakePyMySQL:
        @staticmethod
        def connect(**kwargs):
            captured["kwargs"] = kwargs
            return _FakeConnection()

    monkeypatch.setitem(sys.modules, "pymysql", _FakePyMySQL)

    report = storage_backend_module.check_mysql_storage_connection()

    assert report["status"] == "ok"
    assert captured["kwargs"]["connect_timeout"] == 3
    assert captured["kwargs"]["read_timeout"] == 3
    assert captured["kwargs"]["write_timeout"] == 3
    assert captured["sql"] == "SELECT 1"
    assert captured["closed"] is True


def test_storage_backend_defaults_to_mysql() -> None:
    assert storage_backend_module.settings.STORAGE_BACKEND == "mysql"


def test_pytest_defaults_use_mysql_runtime() -> None:
    assert os.environ["STORAGE_BACKEND"] == "mysql"


def test_repository_no_longer_ships_runtime_json_artifacts() -> None:
    repo_root = Path(__file__).resolve().parents[2]

    assert (repo_root / "app" / "data" / "mes_store.json").exists() is False
    assert (repo_root / "scripts" / "migrate_json_to_mysql.py").exists() is False
    assert (repo_root / "scripts" / "export_mysql_snapshot.py").exists() is False
