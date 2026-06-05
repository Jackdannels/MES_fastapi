from __future__ import annotations

import random
from datetime import datetime, timedelta
from typing import Any

from app.core.storage_backend import EXPERIMENT_TYPE_OPTIONS, normalize_storage_payload

TASK_COUNT = 20
MANDATORY_EXPERIMENT_TYPE = "盐雾试验"


def _task_code(index: int, base_time: datetime) -> str:
    return f"SYLU-{base_time.year}-{base_time.month:02d}-{index:03d}"


def _task_source(index: int) -> str:
    return "外部委托" if index <= 10 else "内部新增"


def build_demo_reset_snapshot(base_snapshot: dict[str, Any] | None = None, now: datetime | None = None) -> dict[str, Any]:
    rng = random.SystemRandom()
    snapshot = dict(base_snapshot or {})
    tasks: list[dict[str, Any]] = []
    samples: list[dict[str, Any]] = []
    experiments: list[dict[str, Any]] = []
    current_time = now or datetime.now()
    base_time = current_time.replace(hour=8, minute=0, second=0, microsecond=0)

    for index in range(1, TASK_COUNT + 1):
        task_code = _task_code(index, base_time)
        remaining_experiment_types = [
            experiment_type for experiment_type in EXPERIMENT_TYPE_OPTIONS if experiment_type != MANDATORY_EXPERIMENT_TYPE
        ]
        experiment_types = [MANDATORY_EXPERIMENT_TYPE, *rng.sample(remaining_experiment_types, 2)]
        rng.shuffle(experiment_types)
        sample_count = rng.randint(5, 12)
        created_at = (base_time + timedelta(hours=index)).strftime("%Y-%m-%d %H:%M:%S")
        arrival_at = (base_time + timedelta(hours=index)).strftime("%Y-%m-%d %H:%M")
        due_at = (base_time + timedelta(days=7, hours=index)).strftime("%Y-%m-%d %H:%M")
        experiment_codes = [f"{task_code}-{suffix}" for suffix in ("A", "B", "C")]
        tasks.append(
            {
                "id": task_code,
                "code": task_code,
                "name": f"演示任务{index:03d}",
                "source": _task_source(index),
                "client": "" if index > 10 else f"委托方{index:03d}",
                "contact": "" if index > 10 else f"联系人{index:03d}",
                "contact_info": "" if index > 10 else f"1380000{index:04d}",
                "priority": "",
                "sample_count": str(sample_count),
                "sample_type": "",
                "test_type": " / ".join(experiment_types),
                "test_types": experiment_types,
                "required_device": experiment_types[0],
                "due_at": due_at,
                "arrival_at": arrival_at,
                "conditions": "",
                "attachment": "",
                "remark": "",
                "status": "待排程",
                "created_at": created_at,
                "tray_codes": [],
                "experiment_codes": experiment_codes,
                "experiment_count": 3,
            }
        )
        for exp_index, experiment_code in enumerate(experiment_codes):
            experiments.append(
                {
                    "id": experiment_code,
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "experiment_name": experiment_types[exp_index],
                    "required_device": experiment_types[exp_index],
                    "priority": "",
                    "planned_hours": 0,
                    "status": "待排程",
                    "created_at": created_at,
                    "updated_at": created_at,
                }
            )
        for sample_index in range(1, sample_count + 1):
            sample_code = f"{task_code}-SP-{sample_index:03d}"
            samples.append(
                {
                    "id": sample_code,
                    "code": sample_code,
                    "task_code": task_code,
                    "sample_type": "",
                    "batch_no": "",
                    "arrival_at": "",
                    "quantity": "",
                    "storage_condition": "",
                    "barcode": "",
                    "remark": "",
                    "location": "",
                    "owner": "",
                    "status": "运输中",
                    "flow_status": "运输中",
                    "created_at": created_at,
                    "updated_at": created_at,
                    "trays": [],
                    "history": [],
                }
            )

    snapshot.update(
        {
            "mes.tasks": tasks,
            "mes.samples": samples,
            "mes.experiments": experiments,
            "mes.schedules": [],
            "mes.experiment_trays": [],
            "mes.experiment_samples": [],
            "mes.experiment_runs": [],
            "mes.streams": [],
            "mes.conflicts": [],
        }
    )
    return normalize_storage_payload(snapshot)


def reset_demo_data(storage_backend: Any) -> dict[str, Any]:
    current_snapshot = storage_backend.read_all() if hasattr(storage_backend, "read_all") else {}
    preserved_snapshot = {
        "mes.devices": list(current_snapshot.get("mes.devices", [])) if isinstance(current_snapshot, dict) else [],
        "mes.meta": dict(current_snapshot.get("mes.meta", {})) if isinstance(current_snapshot, dict) else {},
    }
    snapshot = build_demo_reset_snapshot(preserved_snapshot)

    storage_backend.write_many(snapshot)
    return snapshot


def run_demo_reset(storage_backend: Any) -> dict[str, Any]:
    snapshot = reset_demo_data(storage_backend)
    return {
        "task_count": len(snapshot.get("mes.tasks", [])),
        "sample_count": len(snapshot.get("mes.samples", [])),
        "experiment_count": len(snapshot.get("mes.experiments", [])),
    }
