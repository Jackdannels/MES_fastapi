from __future__ import annotations

from app.core.mysql_storage_backend import (
    STORAGE_MARKER,
    build_sample_insert_row,
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
        "device": "恒温恒湿间（暂存间）",
        "start_at": "2026-03-17T10:00:00Z",
        "end_at": "2026-03-17T10:00:00Z",
        "planned_hours": 0,
        "status": "暂存间排放",
    }

    insert_row = build_schedule_insert_row(storage_schedule)

    assert insert_row["schedule_no"] == "schedule-1"
    assert insert_row["schedule_type"] == STORAGE_MARKER
    assert insert_row["is_retention"] == 1

    storage_item = build_storage_schedule_item(
        {
            **insert_row,
            "schedule_id": 5,
        }
    )

    assert storage_item["id"] == "schedule-1"
    assert storage_item["device"] == "恒温恒湿间（暂存间）"
    assert storage_item["planned_hours"] == 0


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
