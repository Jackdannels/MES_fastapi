from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from app.core.storage_contract import STORAGE_KEYS


TASK_COUNT = 33
SAMPLE_COUNT = 3200
EXPERIMENT_COUNT = TASK_COUNT * 4
EXPERIMENT_SAMPLE_COUNT = 4800
HIGH_VOLUME_TASK_COUNT = 10
HIGH_VOLUME_TASK_SAMPLE_COUNT = 99
CAPACITY_DATABASE_PATTERN = re.compile(r"(?:_perf|_capacity|_benchmark|_test)$", re.IGNORECASE)
CONFIRMATION_TEXT = "REPLACE_CAPACITY_DATABASE"


def task_sample_counts() -> list[int]:
    high_volume_total = HIGH_VOLUME_TASK_COUNT * HIGH_VOLUME_TASK_SAMPLE_COUNT
    remaining_task_count = TASK_COUNT - HIGH_VOLUME_TASK_COUNT
    remaining_sample_count = SAMPLE_COUNT - high_volume_total
    base_count, extra_count = divmod(remaining_sample_count, remaining_task_count)
    return [
        *([HIGH_VOLUME_TASK_SAMPLE_COUNT] * HIGH_VOLUME_TASK_COUNT),
        *(base_count + (1 if index < extra_count else 0) for index in range(remaining_task_count)),
    ]


def build_capacity_snapshot() -> dict[str, list[dict[str, Any]]]:
    base_time = datetime(2026, 1, 5, 8, 0, tzinfo=timezone(timedelta(hours=8)))
    tasks: list[dict[str, Any]] = []
    samples: list[dict[str, Any]] = []
    experiments: list[dict[str, Any]] = []
    experiment_samples: list[dict[str, Any]] = []
    experiment_trays: list[dict[str, Any]] = []
    schedules: list[dict[str, Any]] = []
    experiment_runs: list[dict[str, Any]] = []
    experiment_run_steps: list[dict[str, Any]] = []
    experiment_run_trays: list[dict[str, Any]] = []
    tray_experiment_keys: set[tuple[str, str, str]] = set()
    global_sample_index = 0

    test_types = ("冲击试验", "振动试验", "盐雾试验", "高低温湿热试验")
    lab_names = ("冲击一室", "振动一室", "盐雾一室", "高低温湿热二室")
    sample_counts = task_sample_counts()
    for task_index in range(TASK_COUNT):
        task_code = f"P0-TASK-{task_index + 1:03d}"
        task_sample_count = sample_counts[task_index]
        task_time = base_time + timedelta(hours=task_index)
        task_status = ("待排程", "已排程", "实验进行中")[task_index % 3]
        tasks.append({
            "id": task_code,
            "code": task_code,
            "name": f"P0固定容量任务{task_index + 1:03d}",
            "source": "P0容量基线",
            "status": task_status,
            "transfer_status": "已入库",
            "planned_sample_count": task_sample_count,
            "experiment_count": 4,
            "test_types": list(test_types),
            "created_at": task_time.isoformat(),
            "updated_at": task_time.isoformat(),
        })

        task_experiment_codes = []
        for experiment_index in range(4):
            experiment_code = f"{task_code}-EXP-{experiment_index + 1:02d}"
            task_experiment_codes.append(experiment_code)
            experiment_status = (
                "实验进行中"
                if task_status == "实验进行中" and experiment_index == task_index % 4
                else "待实验"
            )
            experiments.append({
                "id": experiment_code,
                "task_code": task_code,
                "experiment_code": experiment_code,
                "experiment_name": test_types[experiment_index],
                "experiment_type": test_types[experiment_index],
                "lab_name": lab_names[experiment_index],
                "sequence": experiment_index + 1,
                "status": experiment_status,
                "updated_at": task_time.isoformat(),
            })
            if experiment_index < 2:
                schedule_code = f"P0-SCHEDULE-{task_index + 1:03d}-{experiment_index + 1}"
                start_at = task_time + timedelta(days=experiment_index + 1)
                schedules.append({
                    "id": schedule_code,
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "experiment_name": test_types[experiment_index],
                    "lab_name": lab_names[experiment_index],
                    "device": lab_names[experiment_index],
                    "start_at": start_at.isoformat(),
                    "end_at": (start_at + timedelta(hours=8)).isoformat(),
                    "planned_hours": 8,
                    "status": "已排程",
                })

        active_experiment = task_experiment_codes[task_index % 4]
        run_code = f"P0-RUN-{task_index + 1:03d}"
        has_active_run = task_status == "实验进行中"
        if has_active_run:
            experiment_runs.append({
                "id": run_code,
                "run_no": run_code,
                "run_id": run_code,
                "task_code": task_code,
                "experiment_code": active_experiment,
                "status": "实验进行中",
                "started_at": task_time.isoformat(),
                "updated_at": task_time.isoformat(),
            })
            for step_index in range(2):
                experiment_run_steps.append({
                    "id": f"{run_code}-STEP-{step_index + 1}",
                    "run_no": run_code,
                    "task_code": task_code,
                    "experiment_code": active_experiment,
                    "axis_code": ("X", "Y")[step_index],
                    "step_no": step_index + 1,
                    "status": "实验进行中" if step_index == 0 else "待实验",
                    "updated_at": task_time.isoformat(),
                })

        for sample_index in range(task_sample_count):
            global_sample_index += 1
            sample_code = f"{task_code}-SP-{sample_index + 1:03d}"
            tray_code = f"{task_code}-TP-{sample_index // 4 + 1:03d}"
            status = ("已入库", "待实验", "实验进行中", "实验已完成")[global_sample_index % 4]
            samples.append({
                "id": sample_code,
                "code": sample_code,
                "task_code": task_code,
                "name": f"固定容量样品{global_sample_index:04d}",
                "status": status,
                "flow_status": status,
                "location": "接驳区" if status != "实验进行中" else lab_names[task_index % 4],
                "owner": "P0容量基线",
                "updated_at": task_time.isoformat(),
                "trays": [{
                    "tray_code": tray_code,
                    "status": status,
                    "updated_at": task_time.isoformat(),
                }],
                "history": [
                    {
                        "action": "P0容量数据生成",
                        "detail": f"{task_code} / {tray_code}",
                        "status": status,
                        "location": "接驳区",
                        "owner": "P0容量基线",
                        "time": task_time.isoformat(),
                        "tray_code": tray_code,
                    },
                    {
                        "action": "样品入库",
                        "detail": sample_code,
                        "status": "已入库",
                        "location": "接驳区",
                        "owner": "P0容量基线",
                        "time": (task_time - timedelta(hours=1)).isoformat(),
                        "tray_code": tray_code,
                    },
                ],
            })
            primary_experiment = task_experiment_codes[sample_index % 4]
            relation_codes = [primary_experiment]
            if global_sample_index % 2 == 1:
                relation_codes.append(task_experiment_codes[(sample_index + 1) % 4])
            for experiment_code in relation_codes:
                experiment_samples.append({
                    "id": f"P0-ES-{len(experiment_samples) + 1:05d}",
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "sample_code": sample_code,
                })
                tray_experiment_keys.add((task_code, experiment_code, tray_code))
            if sample_index == 0 and has_active_run:
                experiment_run_trays.append({
                    "id": f"{run_code}-TRAY",
                    "run_no": run_code,
                    "task_code": task_code,
                    "experiment_code": active_experiment,
                    "tray_code": tray_code,
                    "status": "实验进行中",
                    "updated_at": task_time.isoformat(),
                })

    experiment_trays.extend(
        {
            "id": f"P0-ET-{index + 1:05d}",
            "task_code": task_code,
            "experiment_code": experiment_code,
            "tray_code": tray_code,
        }
        for index, (task_code, experiment_code, tray_code) in enumerate(sorted(tray_experiment_keys))
    )
    devices = [
        {
            "id": f"P0-DEVICE-{index + 1:02d}",
            "code": f"P0-DEVICE-{index + 1:02d}",
            "name": f"P0容量设备{index + 1:02d}",
            "lab_name": lab_names[index % len(lab_names)],
            "status": "运行" if index % 3 == 0 else "空闲",
            "location": lab_names[index % len(lab_names)],
        }
        for index in range(11)
    ]
    snapshot = {key: [] for key in STORAGE_KEYS}
    snapshot.update({
        "mes.tasks": tasks,
        "mes.samples": samples,
        "mes.experiments": experiments,
        "mes.experiment_runs": experiment_runs,
        "mes.experiment_run_steps": experiment_run_steps,
        "mes.experiment_run_trays": experiment_run_trays,
        "mes.experiment_trays": experiment_trays,
        "mes.experiment_samples": experiment_samples,
        "mes.schedules": schedules,
        "mes.devices": devices,
        "mes.streams": [{
            "id": "P0-BASELINE-STREAM",
            "task_code": "P0-TASK-001",
            "device": "P0-DEVICE-01",
            "last_packet": base_time.isoformat(),
            "quality": 1.0,
            "status": "正常",
            "reported": False,
        }],
        "mes.conflicts": [],
        "mes.staging_events": [],
    })
    return snapshot


def validate_capacity_database(database: str) -> None:
    if not CAPACITY_DATABASE_PATTERN.search(str(database or "").strip()):
        raise RuntimeError(
            "拒绝覆盖非容量数据库；MYSQL_DATABASE 必须以 _perf、_capacity、_benchmark 或 _test 结尾"
        )


def validate_capacity_target(
    *,
    host: str,
    port: int,
    database: str,
    expected_host: str,
    expected_port: int,
    expected_database: str,
) -> None:
    validate_capacity_database(database)
    actual = (str(host).strip().lower(), int(port), str(database).strip())
    expected = (str(expected_host).strip().lower(), int(expected_port), str(expected_database).strip())
    if actual != expected:
        raise RuntimeError(f"容量数据库目标不匹配：actual={actual}, expected={expected}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成确定性的 MES P0 容量数据")
    parser.add_argument("--output", default="artifacts/performance/p0-capacity-snapshot.json")
    parser.add_argument("--apply", action="store_true", help="写入当前环境指定的隔离 MySQL 数据库")
    parser.add_argument("--confirm-replace", default="", help=f"写入时必须明确传入 {CONFIRMATION_TEXT}")
    parser.add_argument("--expected-host", default="")
    parser.add_argument("--expected-port", type=int, default=0)
    parser.add_argument("--expected-database", default="")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    snapshot = build_capacity_snapshot()
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if args.apply:
        if args.confirm_replace != CONFIRMATION_TEXT:
            raise SystemExit(f"写入容量数据库必须传入 --confirm-replace {CONFIRMATION_TEXT}")
        from app.core.config import settings
        from scripts.init_mysql_storage import create_mysql_storage_backend, initialize_mysql_storage

        if not args.expected_host or args.expected_port <= 0 or not args.expected_database:
            raise SystemExit("写入容量数据库必须同时提供 expected-host/expected-port/expected-database")
        validate_capacity_target(
            host=settings.MYSQL_HOST,
            port=settings.MYSQL_PORT,
            database=settings.MYSQL_DATABASE,
            expected_host=args.expected_host,
            expected_port=args.expected_port,
            expected_database=args.expected_database,
        )
        initialize_mysql_storage(seed_demo=False)
        create_mysql_storage_backend().write_many(snapshot)

    summary = {
        "output": str(output_path),
        "applied": bool(args.apply),
        "tasks": len(snapshot["mes.tasks"]),
        "samples": len(snapshot["mes.samples"]),
        "experiments": len(snapshot["mes.experiments"]),
        "experimentSamples": len(snapshot["mes.experiment_samples"]),
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
