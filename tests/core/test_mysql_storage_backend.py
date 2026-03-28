from __future__ import annotations

from app.core.mysql_storage_backend import (
    STORAGE_MARKER,
    MySQLConnectionSettings,
    MySQLMesStorageBackend,
    normalize_storage_payload,
    build_experiment_insert_row,
    build_experiment_sample_insert_row,
    build_experiment_tray_insert_row,
    build_sample_insert_row,
    build_storage_experiment_item,
    build_storage_experiment_sample_item,
    build_storage_experiment_tray_item,
    build_storage_sample_item,
    build_device_insert_row,
    build_schedule_insert_row,
    build_storage_device_item,
    build_storage_schedule_item,
    build_storage_stream_item,
    build_storage_task_item,
    build_storage_task_tray_codes,
    build_stream_insert_row,
    build_task_insert_row,
)


def test_task_mapping_round_trip_preserves_frontend_fields() -> None:
    storage_task = {
        "id": "task-1",
        "code": "ZD-2026-003",
        "name": "振动试验任务",
        "source": "内部新增",
        "client": "内部部门",
        "contact": "调度员001",
        "contact_info": "13800000001",
        "priority": "高",
        "sample_count": "3",
        "sample_type": "结构件",
        "test_type": "振动试验",
        "required_device": "振动试验",
        "due_at": "2026-03-18 10:00",
        "arrival_at": "2026-03-17 09:00",
        "conditions": "标准条件",
        "attachment": "/tmp/task.pdf",
        "remark": "任务备注",
        "status": "待排程",
        "created_at": "2026-03-17T09:00:00",
    }

    insert_row = build_task_insert_row(storage_task)

    assert insert_row["task_no"] == "ZD-2026-003"
    assert insert_row["source_system"] == STORAGE_MARKER
    assert insert_row["priority"] == 3
    assert insert_row["sample_count"] == 3

    storage_item = build_storage_task_item(
        {
            **insert_row,
            "task_id": 12,
            "created_at": insert_row["created_at"],
        }
    )

    assert storage_item["id"] == "ZD-2026-003"
    assert storage_item["priority"] == "高"
    assert storage_item["contact_info"] == "13800000001"
    assert storage_item["due_at"] == "2026-03-18 10:00"


def test_schedule_mapping_round_trip_preserves_retention_and_hours() -> None:
    storage_schedule = {
        "id": "schedule-1",
        "task_code": "ZD-2026-003",
        "experiment_code": "ZD-2026-003-A",
        "device": "恒温恒湿间（暂存间）",
        "start_at": "2026-03-17T10:00:00Z",
        "end_at": "2026-03-17T10:00:00Z",
        "planned_hours": 0,
        "status": "暂存间排放",
    }

    insert_row = build_schedule_insert_row(storage_schedule)

    assert insert_row["schedule_no"] == "schedule-1"
    assert insert_row["schedule_type"] == STORAGE_MARKER
    assert insert_row["experiment_no"] == "ZD-2026-003-A"
    assert insert_row["is_retention"] == 1

    storage_item = build_storage_schedule_item(
        {
            **insert_row,
            "schedule_id": 5,
        }
    )

    assert storage_item["id"] == "schedule-1"
    assert storage_item["device"] == "恒温恒湿间（暂存间）"
    assert storage_item["experiment_code"] == "ZD-2026-003-A"
    assert storage_item["planned_hours"] == 0


def test_experiment_mapping_round_trip_preserves_task_and_device_fields() -> None:
    storage_experiment = {
        "id": "experiment-1",
        "task_code": "SZH-2026-006",
        "experiment_code": "SZH-2026-006-A",
        "experiment_name": "A实验",
        "required_device": "四综合试验",
        "priority": "高",
        "planned_hours": 3.5,
        "status": "待排程",
        "created_at": "2026-03-17T09:30:00Z",
        "updated_at": "2026-03-17T09:35:00Z",
    }

    insert_row = build_experiment_insert_row(storage_experiment)

    assert insert_row["experiment_no"] == "SZH-2026-006-A"
    assert insert_row["task_no"] == "SZH-2026-006"
    assert insert_row["required_device"] == "四综合试验"

    storage_item = build_storage_experiment_item(
        {
            **insert_row,
            "experiment_id": 8,
        }
    )

    assert storage_item["experiment_code"] == "SZH-2026-006-A"
    assert storage_item["task_code"] == "SZH-2026-006"
    assert storage_item["experiment_name"] == "A实验"
    assert storage_item["status"] == "待排程"


def test_experiment_tray_mapping_round_trip_preserves_assignment_keys() -> None:
    relation = {
        "id": "rel-1",
        "task_code": "SZH-2026-006",
        "experiment_code": "SZH-2026-006-A",
        "tray_code": "SZH-2026-006-TP-001",
        "created_at": "2026-03-17T09:40:00Z",
        "updated_at": "2026-03-17T09:41:00Z",
    }

    insert_row = build_experiment_tray_insert_row(relation)

    assert insert_row["experiment_no"] == "SZH-2026-006-A"
    assert insert_row["task_no"] == "SZH-2026-006"
    assert insert_row["tray_no"] == "SZH-2026-006-TP-001"

    storage_item = build_storage_experiment_tray_item(
        {
            **insert_row,
            "relation_id": 11,
        }
    )

    assert storage_item["experiment_code"] == "SZH-2026-006-A"
    assert storage_item["task_code"] == "SZH-2026-006"
    assert storage_item["tray_code"] == "SZH-2026-006-TP-001"


def test_experiment_sample_mapping_round_trip_preserves_assignment_keys() -> None:
    relation = {
        "id": "rel-2",
        "task_code": "SZH-2026-006",
        "experiment_code": "SZH-2026-006-A",
        "sample_code": "SZH-2026-006-SP-001",
        "created_at": "2026-03-17T09:42:00Z",
        "updated_at": "2026-03-17T09:43:00Z",
    }

    insert_row = build_experiment_sample_insert_row(relation)

    assert insert_row["experiment_no"] == "SZH-2026-006-A"
    assert insert_row["task_no"] == "SZH-2026-006"
    assert insert_row["sample_no"] == "SZH-2026-006-SP-001"

    storage_item = build_storage_experiment_sample_item(
        {
            **insert_row,
            "relation_id": 12,
        }
    )

    assert storage_item["experiment_code"] == "SZH-2026-006-A"
    assert storage_item["task_code"] == "SZH-2026-006"
    assert storage_item["sample_code"] == "SZH-2026-006-SP-001"


def test_device_mapping_round_trip_preserves_owner_and_calibration_date() -> None:
    storage_device = {
        "id": "device-1",
        "code": "振动一室",
        "name": "振动试验系统-1",
        "type": "振动试验",
        "status": "可用",
        "location": "振动一室",
        "next_cal": "2026-07-12",
        "owner": "张三",
        "acquisition_enabled": "启用",
    }

    insert_row = build_device_insert_row(storage_device)

    assert insert_row["equipment_code"] == "振动一室"
    assert insert_row["manufacturer"] == STORAGE_MARKER
    assert insert_row["remark"] == "张三"

    storage_item = build_storage_device_item(
        {
            **insert_row,
            "equipment_id": 3,
        }
    )

    assert storage_item["id"] == "振动一室"
    assert storage_item["owner"] == "张三"
    assert storage_item["next_cal"] == "2026-07-12"


def test_stream_mapping_round_trip_formats_quality_and_reported_flag() -> None:
    storage_stream = {
        "id": "stream-1",
        "task_code": "ZD-2026-003",
        "device": "振动一室",
        "last_packet": "2026-03-17 10:15",
        "quality": "98.5%",
        "status": "采集中",
        "reported": False,
    }

    insert_row = build_stream_insert_row(storage_stream)

    assert insert_row["stream_no"] == "stream-1"
    assert insert_row["quality_value"] == 98.5
    assert insert_row["remark"] == STORAGE_MARKER

    storage_item = build_storage_stream_item(
        {
            **insert_row,
            "stream_id": 9,
        }
    )

    assert storage_item["id"] == "stream-1"
    assert storage_item["quality"] == "98.5%"
    assert storage_item["reported"] is False


def test_sample_mapping_round_trip_preserves_owner_remark_history_and_trays() -> None:
    storage_sample = {
        "id": "sample-1",
        "code": "ZD-2026-003-SP-001",
        "task_code": "ZD-2026-003",
        "sample_type": "结构件",
        "batch_no": "BATCH-01",
        "arrival_at": "2026-03-17 09:30",
        "quantity": "2",
        "storage_condition": "常温",
        "barcode": "BC-001",
        "remark": "样品备注",
        "location": "接驳区",
        "owner": "张三",
        "status": "到货",
        "flow_status": "到货",
        "created_at": "2026-03-17T09:30:00Z",
        "updated_at": "2026-03-17T10:00:00Z",
        "trays": [
            {
                "id": "tray-row-1",
                "tray_code": "ZD-2026-003-TP-001",
                "sample_code": "ZD-2026-003-SP-001",
                "quantity": 1,
                "created_at": "2026-03-17T09:40:00Z",
                "updated_at": "2026-03-17T09:40:00Z",
            }
        ],
        "history": [
            {
                "id": "event-1",
                "time": "2026-03-17T09:35:00Z",
                "action": "样品登记",
                "location": "接驳区",
                "owner": "张三",
                "status": "运输中",
                "detail": "登记完成",
            }
        ],
    }

    insert_row = build_sample_insert_row(storage_sample)

    assert insert_row["sample_no"] == "ZD-2026-003-SP-001"
    assert insert_row["sample_status"] == "到货"
    assert insert_row["quantity"] == 2
    assert insert_row["task_no"] == "ZD-2026-003"
    assert STORAGE_MARKER in insert_row["remark"]

    storage_item = build_storage_sample_item(
        {
            **insert_row,
            "sample_id": 7,
            "sample_name": "ZD-2026-003-SP-001",
        },
        tray_rows=storage_sample["trays"],
        event_rows=storage_sample["history"],
    )

    assert storage_item["id"] == "ZD-2026-003-SP-001"
    assert storage_item["owner"] == "张三"
    assert storage_item["remark"] == "样品备注"
    assert storage_item["trays"][0]["tray_code"] == "ZD-2026-003-TP-001"
    assert storage_item["history"][0]["action"] == "样品登记"
    assert storage_item["history"][0]["detail"] == "登记完成"


def test_task_round_trip_includes_tray_codes_from_tray_rows() -> None:
    tray_rows = [
        {"task_no": "ZD-2026-003", "tray_no": "ZD-2026-003-TP-002"},
        {"task_no": "ZD-2026-003", "tray_no": "ZD-2026-003-TP-001"},
        {"task_no": "OTHER", "tray_no": "OTHER-TP-001"},
    ]

    tray_map = build_storage_task_tray_codes(tray_rows)
    storage_item = build_storage_task_item(
        {
            "task_no": "ZD-2026-003",
            "task_name": "振动试验任务",
            "task_source_type": "内部新增",
            "client_name": "内部部门",
            "contact_name": "调度员001",
            "contact_phone": "13800000001",
            "priority": 3,
            "sample_count": 3,
            "sample_type": "结构件",
            "task_type": "振动试验",
            "required_device": "振动试验",
            "due_time": "2026-03-18 10:00:00",
            "arrival_time": "2026-03-17 09:00:00",
            "conditions_text": "",
            "attachment_path": "",
            "remark": "",
            "task_status": "待排程",
            "created_at": "2026-03-17 09:00:00",
        },
        tray_codes=tray_map.get("ZD-2026-003"),
    )

    assert storage_item["tray_codes"] == ["ZD-2026-003-TP-001", "ZD-2026-003-TP-002"]


def test_build_storage_sample_item_recovers_task_code_from_sample_code_when_task_join_is_missing() -> None:
    storage_item = build_storage_sample_item(
        {
            "sample_id": 99,
            "sample_no": "SYLU-2026-03-001-SP-001",
            "task_no": None,
            "sample_type": "",
            "batch_no": "",
            "arrival_time": None,
            "quantity": 1,
            "storage_condition": "",
            "barcode_no": "",
            "location_desc": "",
            "sample_status": "运输中",
            "flow_status": "运输中",
            "remark": f"{STORAGE_MARKER}:SAMPLE:{{\"owner\":\"\",\"remark\":\"\"}}",
            "created_at": "2026-03-17 09:00:00",
            "updated_at": "2026-03-17 09:00:00",
        }
    )

    assert storage_item["task_code"] == "SYLU-2026-03-001"


def test_normalize_storage_payload_migrates_legacy_relational_rows_to_sylu_identifiers() -> None:
    payload = {
        "mes.tasks": [
            {
                "id": "task-1",
                "code": "GDW-2024-005",
                "name": "高低温湿热试验-批次E",
                "test_type": "高低温湿热试验",
                "created_at": "2026-03-05T09:00:00",
            }
        ],
        "mes.samples": [
            {
                "id": "sample-1",
                "code": "GDW-2024-005-SP-001",
                "task_code": "GDW-2024-005",
                "created_at": "2026-03-05T09:05:00",
                "trays": [
                    {
                        "tray_code": "GDW-2024-005-TP-001",
                        "sample_code": "GDW-2024-005-SP-001",
                        "quantity": 1,
                    }
                ],
            }
        ],
        "mes.schedules": [
            {
                "id": "schedule-1",
                "task_code": "GDW-2024-005",
                "experiment_code": "GDW-2024-005-A",
                "device": "高低温实验室",
            }
        ],
        "mes.experiments": [],
        "mes.experiment_trays": [
            {
                "task_code": "GDW-2024-005",
                "experiment_code": "GDW-2024-005-A",
                "tray_code": "GDW-2024-005-TP-001",
            }
        ],
        "mes.streams": [{"id": "stream-1", "task_code": "GDW-2024-005"}],
    }

    normalized = normalize_storage_payload(payload)

    assert normalized["mes.tasks"][0]["code"] == "SYLU-2026-03-001"
    assert normalized["mes.tasks"][0]["experiment_codes"] == ["SYLU-2026-03-001-A", "SYLU-2026-03-001-B", "SYLU-2026-03-001-C"]
    assert normalized["mes.samples"][0]["code"] == "SYLU-2026-03-001-SP-001"
    assert normalized["mes.samples"][0]["trays"][0]["tray_code"] == "SYLU-2026-03-001-TP-001"
    assert normalized["mes.schedules"][0]["experiment_code"] == "SYLU-2026-03-001-A"
    assert normalized["mes.experiment_trays"][0]["tray_code"] == "SYLU-2026-03-001-TP-001"
    assert normalized["mes.streams"][0]["task_code"] == "SYLU-2026-03-001"
    assert normalized["mes.experiments"][0]["experiment_name"] == "高低温湿热试验"
    assert normalized["mes.experiments"][1]["experiment_name"] == "冲击试验"
    assert normalized["mes.experiments"][2]["experiment_name"] == "振动试验"
    assert normalized["mes.meta"]["schema_version"] == 2


def test_experiment_and_schedule_rows_round_trip_with_migrated_sylu_codes() -> None:
    normalized = normalize_storage_payload(
        {
            "mes.tasks": [
                {
                    "id": "task-1",
                    "code": "SZH-2026-006",
                    "name": "四综合任务",
                    "test_type": "四综合试验",
                    "created_at": "2026-03-17T09:00:00",
                }
            ],
            "mes.experiments": [
                {
                    "id": "experiment-1",
                    "task_code": "SZH-2026-006",
                    "experiment_code": "SZH-2026-006-A",
                    "experiment_name": "A实验",
                    "required_device": "四综合试验",
                    "status": "待排程",
                }
            ],
            "mes.schedules": [
                {
                    "id": "schedule-1",
                    "task_code": "SZH-2026-006",
                    "experiment_code": "SZH-2026-006-A",
                    "device": "四综合实验室",
                    "start_at": "2026-03-20T08:00:00Z",
                    "end_at": "2026-03-20T12:00:00Z",
                    "status": "已排程",
                }
            ],
            "mes.samples": [],
            "mes.experiment_trays": [],
            "mes.streams": [],
        }
    )

    experiment_row = build_experiment_insert_row(normalized["mes.experiments"][0])
    schedule_row = build_schedule_insert_row(normalized["mes.schedules"][0])
    experiment_item = build_storage_experiment_item(experiment_row)
    schedule_item = build_storage_schedule_item(schedule_row)

    assert experiment_row["task_no"] == "SYLU-2026-03-001"
    assert experiment_row["experiment_no"] == "SYLU-2026-03-001-A"
    assert experiment_item["experiment_name"] == "四综合试验"
    assert schedule_row["experiment_no"] == "SYLU-2026-03-001-A"
    assert schedule_item["task_code"] == "SYLU-2026-03-001"
    assert schedule_item["experiment_code"] == "SYLU-2026-03-001-A"


class _DummySnapshotRepository:
    def read_all(self):
        return {}

    def write_many(self, updates):
        return None


class _DummyCursor:
    def execute(self, *args, **kwargs):
        return None

    def executemany(self, *args, **kwargs):
        return None


class _DummyConnection:
    def cursor(self):
        cursor = _DummyCursor()

        class _CursorContext:
            def __enter__(self_inner):
                return cursor

            def __exit__(self_inner, exc_type, exc, tb):
                return False

        return _CursorContext()

    def commit(self):
        return None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_write_many_internal_updates_children_before_task_cleanup(monkeypatch) -> None:
    backend = MySQLMesStorageBackend(
        MySQLConnectionSettings(host="127.0.0.1", port=3306, user="root", password="", database="mes"),
        _DummySnapshotRepository(),
    )

    order = []

    monkeypatch.setattr(backend, "_ensure_schema_extensions", lambda: None)
    monkeypatch.setattr(backend, "_connect", lambda: _DummyConnection())
    monkeypatch.setattr(backend, "_replace_devices", lambda cursor, rows: order.append("devices"))
    monkeypatch.setattr(backend, "_replace_tasks", lambda cursor, rows, prune=True: order.append(f"tasks:{prune}"))
    monkeypatch.setattr(backend, "_replace_schedules", lambda cursor, rows: order.append("schedules"))
    monkeypatch.setattr(backend, "_replace_streams", lambda cursor, rows: order.append("streams"))
    monkeypatch.setattr(backend, "_replace_samples", lambda cursor, rows: order.append("samples"))
    monkeypatch.setattr(backend, "_replace_experiments", lambda cursor, rows: order.append("experiments"))
    monkeypatch.setattr(backend, "_replace_experiment_trays", lambda cursor, rows: order.append("experiment_trays"))
    monkeypatch.setattr(backend, "_replace_experiment_samples", lambda cursor, rows: order.append("experiment_samples"))

    backend._write_many_internal(
        {
            "mes.tasks": [{"code": "SYLU-2026-03-001"}],
            "mes.samples": [{"code": "SYLU-2026-03-001-SP-001", "task_code": "SYLU-2026-03-001"}],
            "mes.experiments": [{"experiment_code": "SYLU-2026-03-001-A", "task_code": "SYLU-2026-03-001"}],
            "mes.experiment_trays": [{"experiment_code": "SYLU-2026-03-001-A", "task_code": "SYLU-2026-03-001", "tray_code": "SYLU-2026-03-001-TP-001"}],
            "mes.experiment_samples": [{"experiment_code": "SYLU-2026-03-001-A", "task_code": "SYLU-2026-03-001", "sample_code": "SYLU-2026-03-001-SP-001"}],
        }
    )

    assert order == ["tasks:False", "samples", "experiments", "experiment_trays", "experiment_samples", "tasks:True"]
