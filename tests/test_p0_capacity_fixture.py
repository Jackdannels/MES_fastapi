from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

import pytest

from app.core.storage_contract import STORAGE_KEYS


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "generate_p0_capacity_fixture.py"
SPEC = importlib.util.spec_from_file_location("generate_p0_capacity_fixture", SCRIPT_PATH)
assert SPEC and SPEC.loader
capacity_fixture = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = capacity_fixture
SPEC.loader.exec_module(capacity_fixture)


def test_capacity_fixture_has_fixed_business_scale_and_is_deterministic() -> None:
    first = capacity_fixture.build_capacity_snapshot()
    second = capacity_fixture.build_capacity_snapshot()

    assert first == second
    assert set(first) == set(STORAGE_KEYS)
    assert len(first["mes.tasks"]) == 33
    assert len(first["mes.samples"]) == 3200
    assert len(first["mes.experiments"]) == 132
    assert len(first["mes.experiment_samples"]) == 4800
    assert capacity_fixture.task_sample_counts()[:10] == [99] * 10
    assert capacity_fixture.task_sample_counts()[10:] == [97] * 2 + [96] * 21
    assert sum(capacity_fixture.task_sample_counts()) == 3200
    assert max(capacity_fixture.task_sample_counts()) == 99
    sample_count_by_task = {
        task["code"]: sum(sample["task_code"] == task["code"] for sample in first["mes.samples"])
        for task in first["mes.tasks"]
    }
    assert [sample_count_by_task[f"P0-TASK-{index:03d}"] for index in range(1, 11)] == [99] * 10
    assert max(sample_count_by_task.values()) == 99
    relation_count_by_task = {
        task["code"]: sum(relation["task_code"] == task["code"] for relation in first["mes.experiment_samples"])
        for task in first["mes.tasks"]
    }
    assert all(
        sample_count_by_task[task_code] + sample_count_by_task[task_code] // 2
        <= relation_count
        <= sample_count_by_task[task_code] + (sample_count_by_task[task_code] + 1) // 2
        for task_code, relation_count in relation_count_by_task.items()
    )
    assert any(
        experiment["lab_name"] == "高低温湿热二室"
        for experiment in first["mes.experiments"]
    )


def test_capacity_fixture_refuses_non_isolated_database_names() -> None:
    with pytest.raises(RuntimeError, match="拒绝覆盖非容量数据库"):
        capacity_fixture.validate_capacity_database("mes_single_branch")

    capacity_fixture.validate_capacity_database("mes_p0_capacity")


def test_capacity_fixture_requires_the_exact_confirmed_host_port_and_database() -> None:
    capacity_fixture.validate_capacity_target(
        host="127.0.0.1",
        port=3337,
        database="mes_p0_capacity",
        expected_host="127.0.0.1",
        expected_port=3337,
        expected_database="mes_p0_capacity",
    )

    with pytest.raises(RuntimeError, match="目标不匹配"):
        capacity_fixture.validate_capacity_target(
            host="127.0.0.1",
            port=3306,
            database="mes_p0_capacity",
            expected_host="127.0.0.1",
            expected_port=3337,
            expected_database="mes_p0_capacity",
        )
