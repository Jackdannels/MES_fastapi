from __future__ import annotations

from datetime import datetime

from app.core.mysql_storage_backend import (
    STORAGE_MARKER,
    MySQLConnectionSettings,
    MySQLMesStorageBackend,
    backfill_missing_unscheduled_since,
    normalize_storage_payload,
    build_experiment_insert_row,
    build_experiment_run_insert_row,
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
    build_storage_experiment_run_item,
    build_storage_stream_item,
    build_storage_task_item,
    build_storage_task_tray_codes,
    build_stream_insert_row,
    build_task_insert_row,
    derive_experiment_status_map,
    derive_task_status_map,
    format_iso_storage_datetime,
    parse_storage_datetime,
    parse_experiment_event_detail,
)
from app.core.demo_data_reset import reset_demo_data


def test_task_mapping_round_trip_preserves_frontend_fields() -> None:
    storage_task = {
        "id": "task-1",
        "code": "SYLU-2026-04-103",
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
        "transfer_status": "已入库",
        "tray_limit": 2,
        "created_at": "2026-03-17T09:00:00",
    }

    insert_row = build_task_insert_row(storage_task)

    assert insert_row["task_no"] == "SYLU-2026-04-103"
    assert insert_row["source_system"] == STORAGE_MARKER
    assert insert_row["priority"] == 3
    assert insert_row["sample_count"] == 3

    storage_item = build_storage_task_item(
        {
            **insert_row,
            "task_id": 12,
            "created_at": insert_row["created_at"],
            "transfer_status": "已入库",
            "tray_limit": 2,
        }
    )

    assert storage_item["id"] == "SYLU-2026-04-103"
    assert storage_item["priority"] == "高"
    assert storage_item["contact_info"] == "13800000001"
    assert storage_item["due_at"] == "2026-03-18 10:00"
    assert storage_item["transfer_status"] == "到货"
    assert storage_item["tray_limit"] == 2


def test_ensure_schema_extensions_expands_task_type_for_all_experiment_summary(monkeypatch) -> None:
    backend = MySQLMesStorageBackend(
        MySQLConnectionSettings(host="127.0.0.1", port=3306, user="root", password="", database="mes"),
        _DummySnapshotRepository(),
    )

    class _CaptureCursor:
        def __init__(self) -> None:
            self.statements = []
            self._result = None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def execute(self, sql, params=None):
            statement = " ".join(str(sql).split())
            self.statements.append(statement)
            if "SHOW COLUMNS FROM biz_task LIKE 'task_type'" in statement:
                self._result = {"Field": "task_type", "Type": "varchar(50)", "Null": "NO"}
            elif statement.startswith("SHOW COLUMNS"):
                self._result = {"Field": "existing", "Type": "varchar(100)"}
            else:
                self._result = None

        def fetchone(self):
            return self._result

    class _CaptureConnection:
        def __init__(self) -> None:
            self.cursor_instance = _CaptureCursor()
            self.committed = False

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def cursor(self):
            return self.cursor_instance

        def commit(self):
            self.committed = True

    connection = _CaptureConnection()
    monkeypatch.setattr(backend, "_connect", lambda: connection)

    backend._ensure_schema_extensions()

    assert any(
        statement == "ALTER TABLE biz_task MODIFY COLUMN task_type VARCHAR(200) NOT NULL"
        for statement in connection.cursor_instance.statements
    )
    assert connection.committed is True


def test_ensure_schema_extensions_adds_mqtt_integration_tables(monkeypatch) -> None:
    backend = MySQLMesStorageBackend(
        MySQLConnectionSettings(host="127.0.0.1", port=3306, user="root", password="", database="mes"),
        _DummySnapshotRepository(),
    )

    class _CaptureCursor:
        def __init__(self) -> None:
            self.statements = []
            self._result = None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def execute(self, sql, params=None):
            statement = " ".join(str(sql).split())
            self.statements.append(statement)
            if "SHOW COLUMNS FROM biz_experiment LIKE 'actual_start_time'" in statement:
                self._result = None
            elif "SHOW COLUMNS FROM biz_experiment LIKE 'actual_end_time'" in statement:
                self._result = None
            elif "SHOW COLUMNS FROM biz_task LIKE 'task_type'" in statement:
                self._result = {"Field": "task_type", "Type": "varchar(200)", "Null": "NO"}
            elif statement.startswith("SHOW COLUMNS"):
                self._result = {"Field": "existing", "Type": "varchar(100)"}
            else:
                self._result = None

        def fetchone(self):
            return self._result

    class _CaptureConnection:
        def __init__(self) -> None:
            self.cursor_instance = _CaptureCursor()
            self.committed = False

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def cursor(self):
            return self.cursor_instance

        def commit(self):
            self.committed = True

    connection = _CaptureConnection()
    monkeypatch.setattr(backend, "_connect", lambda: connection)

    backend._ensure_schema_extensions()

    statements = connection.cursor_instance.statements
    assert any("CREATE TABLE IF NOT EXISTS md_test_type" in statement for statement in statements)
    assert any("CREATE TABLE IF NOT EXISTS md_lab" in statement for statement in statements)
    assert sum(1 for statement in statements if "INSERT INTO md_test_type" in statement and "WHERE NOT EXISTS" in statement) == 7
    assert sum(1 for statement in statements if "INSERT INTO md_lab" in statement and "WHERE NOT EXISTS" in statement) == 14
    assert any("ALTER TABLE biz_experiment ADD COLUMN actual_start_time DATETIME NULL" in statement for statement in statements)
    assert any("ALTER TABLE biz_experiment ADD COLUMN actual_end_time DATETIME NULL" in statement for statement in statements)
    assert any("CREATE TABLE IF NOT EXISTS biz_mq_message_log" in statement for statement in statements)
    assert any("CREATE TABLE IF NOT EXISTS biz_experiment_event" in statement for statement in statements)
    assert any("CREATE TABLE IF NOT EXISTS biz_experiment_result" in statement for statement in statements)
    assert connection.committed is True


def test_ensure_schema_extensions_adds_missing_master_data_columns(monkeypatch) -> None:
    backend = MySQLMesStorageBackend(
        MySQLConnectionSettings(host="127.0.0.1", port=3306, user="root", password="", database="mes"),
        _DummySnapshotRepository(),
    )

    class _CaptureCursor:
        def __init__(self) -> None:
            self.statements = []
            self._result = None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def execute(self, sql, params=None):
            statement = " ".join(str(sql).split())
            self.statements.append(statement)
            if "SHOW COLUMNS FROM md_lab LIKE 'test_type_id'" in statement:
                self._result = None
            elif "SHOW COLUMNS FROM md_test_type LIKE 'test_category'" in statement:
                self._result = None
            elif "SHOW COLUMNS FROM md_equipment LIKE 'maintenance_" in statement:
                self._result = None
            elif "SHOW COLUMNS FROM biz_task LIKE 'task_type'" in statement:
                self._result = {"Field": "task_type", "Type": "varchar(200)", "Null": "NO"}
            elif statement.startswith("SHOW COLUMNS"):
                self._result = {"Field": "existing", "Type": "varchar(100)"}
            else:
                self._result = None

        def fetchone(self):
            return self._result

    class _CaptureConnection:
        def __init__(self) -> None:
            self.cursor_instance = _CaptureCursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def cursor(self):
            return self.cursor_instance

        def commit(self):
            pass

    connection = _CaptureConnection()
    monkeypatch.setattr(backend, "_connect", lambda: connection)

    backend._ensure_schema_extensions()

    statements = connection.cursor_instance.statements
    assert any("ALTER TABLE md_test_type ADD COLUMN test_category VARCHAR(50) NULL" in statement for statement in statements)
    assert any("ALTER TABLE md_lab ADD COLUMN test_type_id BIGINT NULL" in statement for statement in statements)
    assert any("ALTER TABLE md_equipment ADD COLUMN maintenance_start_at DATETIME NULL" in statement for statement in statements)
    assert any("ALTER TABLE md_equipment ADD COLUMN maintenance_end_at DATETIME NULL" in statement for statement in statements)
    assert any("ALTER TABLE md_equipment ADD COLUMN maintenance_type VARCHAR(30) NULL" in statement for statement in statements)
    assert any("ALTER TABLE md_equipment ADD COLUMN maintenance_note VARCHAR(500) NULL" in statement for statement in statements)


def test_ensure_schema_extensions_adds_missing_master_data_indexes(monkeypatch) -> None:
    backend = MySQLMesStorageBackend(
        MySQLConnectionSettings(host="127.0.0.1", port=3306, user="root", password="", database="mes"),
        _DummySnapshotRepository(),
    )

    class _CaptureCursor:
        def __init__(self) -> None:
            self.statements = []
            self._result = None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def execute(self, sql, params=None):
            statement = " ".join(str(sql).split())
            self.statements.append(statement)
            if statement.startswith("SHOW INDEX FROM md_test_type WHERE Key_name = 'uk_md_test_type_code'"):
                self._result = None
            elif statement.startswith("SHOW INDEX FROM md_lab WHERE Key_name = 'uk_md_lab_code'"):
                self._result = None
            elif statement.startswith("SHOW INDEX FROM md_lab WHERE Key_name = 'idx_md_lab_test_type'"):
                self._result = None
            elif "HAVING COUNT(*) > 1" in statement:
                self._result = None
            elif "SHOW COLUMNS FROM biz_task LIKE 'task_type'" in statement:
                self._result = {"Field": "task_type", "Type": "varchar(200)", "Null": "NO"}
            elif statement.startswith("SHOW COLUMNS"):
                self._result = {"Field": "existing", "Type": "varchar(100)"}
            else:
                self._result = None

        def fetchone(self):
            return self._result

    class _CaptureConnection:
        def __init__(self) -> None:
            self.cursor_instance = _CaptureCursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def cursor(self):
            return self.cursor_instance

        def commit(self):
            pass

    connection = _CaptureConnection()
    monkeypatch.setattr(backend, "_connect", lambda: connection)

    backend._ensure_schema_extensions()

    statements = connection.cursor_instance.statements
    assert any("ALTER TABLE md_test_type ADD UNIQUE KEY uk_md_test_type_code (test_type_code)" in statement for statement in statements)
    assert any("ALTER TABLE md_lab ADD UNIQUE KEY uk_md_lab_code (lab_code)" in statement for statement in statements)
    assert any("ALTER TABLE md_lab ADD INDEX idx_md_lab_test_type (test_type_id)" in statement for statement in statements)


def test_ensure_schema_extensions_skips_unique_master_data_indexes_when_duplicates_exist(monkeypatch) -> None:
    backend = MySQLMesStorageBackend(
        MySQLConnectionSettings(host="127.0.0.1", port=3306, user="root", password="", database="mes"),
        _DummySnapshotRepository(),
    )

    class _CaptureCursor:
        def __init__(self) -> None:
            self.statements = []
            self._result = None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def execute(self, sql, params=None):
            statement = " ".join(str(sql).split())
            self.statements.append(statement)
            if statement.startswith("SHOW INDEX FROM md_test_type WHERE Key_name = 'uk_md_test_type_code'"):
                self._result = None
            elif statement.startswith("SHOW INDEX FROM md_lab WHERE Key_name = 'uk_md_lab_code'"):
                self._result = None
            elif "FROM md_test_type" in statement and "HAVING COUNT(*) > 1" in statement:
                self._result = {"test_type_code": "YW", "row_count": 2}
            elif "FROM md_lab" in statement and "HAVING COUNT(*) > 1" in statement:
                self._result = {"lab_code": "LAB_SALT", "row_count": 2}
            elif "SHOW COLUMNS FROM biz_task LIKE 'task_type'" in statement:
                self._result = {"Field": "task_type", "Type": "varchar(200)", "Null": "NO"}
            elif statement.startswith("SHOW COLUMNS"):
                self._result = {"Field": "existing", "Type": "varchar(100)"}
            else:
                self._result = None

        def fetchone(self):
            return self._result

    class _CaptureConnection:
        def __init__(self) -> None:
            self.cursor_instance = _CaptureCursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def cursor(self):
            return self.cursor_instance

        def commit(self):
            pass

    connection = _CaptureConnection()
    monkeypatch.setattr(backend, "_connect", lambda: connection)

    backend._ensure_schema_extensions()

    statements = connection.cursor_instance.statements
    assert not any("ALTER TABLE md_test_type ADD UNIQUE KEY uk_md_test_type_code" in statement for statement in statements)
    assert not any("ALTER TABLE md_lab ADD UNIQUE KEY uk_md_lab_code" in statement for statement in statements)
    assert any("INSERT INTO md_test_type" in statement and "WHERE NOT EXISTS" in statement for statement in statements)
    assert any("INSERT INTO md_lab" in statement and "WHERE NOT EXISTS" in statement for statement in statements)


def test_schedule_mapping_round_trip_preserves_retention_and_hours() -> None:
    storage_schedule = {
        "id": "schedule-1",
        "task_code": "SYLU-2026-04-103",
        "experiment_code": "SYLU-2026-04-103-A",
        "device": "恒温恒湿间（暂存间）",
        "start_at": "2026-03-17T10:00:00Z",
        "end_at": "2026-03-17T10:00:00Z",
        "planned_hours": 0,
        "status": "暂存间排放",
    }

    insert_row = build_schedule_insert_row(storage_schedule)

    assert insert_row["schedule_no"] == "schedule-1"
    assert insert_row["schedule_type"] == STORAGE_MARKER
    assert insert_row["experiment_no"] == "SYLU-2026-04-103-A"
    assert insert_row["is_retention"] == 1

    storage_item = build_storage_schedule_item(
        {
            **insert_row,
            "schedule_id": 5,
        }
    )

    assert storage_item["id"] == "schedule-1"
    assert storage_item["device"] == "恒温恒湿间（暂存间）"
    assert storage_item["experiment_code"] == "SYLU-2026-04-103-A"
    assert storage_item["planned_hours"] == 0


def test_experiment_mapping_round_trip_preserves_task_and_device_fields() -> None:
    storage_experiment = {
        "id": "experiment-1",
        "task_code": "SYLU-2026-04-106",
        "experiment_code": "SYLU-2026-04-106-A",
        "experiment_name": "A实验",
        "required_device": "四综合试验",
        "priority": "高",
        "planned_hours": 3.5,
        "status": "待排程",
        "created_at": "2026-03-17T09:30:00Z",
        "updated_at": "2026-03-17T09:35:00Z",
    }

    insert_row = build_experiment_insert_row(storage_experiment)

    assert insert_row["experiment_no"] == "SYLU-2026-04-106-A"
    assert insert_row["task_no"] == "SYLU-2026-04-106"
    assert insert_row["required_device"] == "四综合试验"

    storage_item = build_storage_experiment_item(
        {
            **insert_row,
            "experiment_id": 8,
        }
    )

    assert storage_item["experiment_code"] == "SYLU-2026-04-106-A"
    assert storage_item["task_code"] == "SYLU-2026-04-106"
    assert storage_item["experiment_name"] == "A实验"
    assert storage_item["status"] == "待排程"


def test_experiment_mapping_round_trip_preserves_unscheduled_since() -> None:
    storage_experiment = {
        "id": "experiment-1",
        "task_code": "SYLU-2026-04-106",
        "experiment_code": "SYLU-2026-04-106-A",
        "experiment_name": "A实验",
        "required_device": "四综合试验",
        "priority": "高",
        "planned_hours": 3.5,
        "status": "待排程",
        "unscheduled_since": "2026-03-17T09:36:00Z",
        "created_at": "2026-03-17T09:30:00Z",
        "updated_at": "2026-03-17T09:35:00Z",
    }

    insert_row = build_experiment_insert_row(storage_experiment)
    storage_item = build_storage_experiment_item(
        {
            **insert_row,
            "experiment_id": 8,
        }
    )

    assert insert_row["unscheduled_since"] is not None
    assert storage_item["unscheduled_since"] == "2026-03-17T17:36:00+08:00"


def test_mysql_storage_datetimes_use_beijing_timezone_for_api_payloads() -> None:
    assert format_iso_storage_datetime(datetime(2026, 4, 21, 15, 4, 5)) == "2026-04-21T15:04:05+08:00"
    assert parse_storage_datetime("2026-04-21T07:04:05Z") == datetime(2026, 4, 21, 15, 4, 5)

    storage_item = build_storage_experiment_item(
        {
            "experiment_no": "SYLU-2026-03-001-B",
            "task_no": "SYLU-2026-03-001",
            "experiment_name": "振动试验",
            "required_device": "振动试验",
            "priority": None,
            "planned_hours": 0,
            "experiment_status": "待排程",
            "unscheduled_since": datetime(2026, 4, 21, 15, 4, 5),
            "created_at": datetime(2026, 3, 1, 9, 0, 0),
            "updated_at": datetime(2026, 4, 21, 15, 29, 32),
        }
    )

    assert storage_item["unscheduled_since"] == "2026-04-21T15:04:05+08:00"


def test_backfill_missing_unscheduled_since_uses_earliest_sample_storage_time() -> None:
    experiments, repaired = backfill_missing_unscheduled_since(
        tasks=[
            {
                "code": "SYLU-2026-04-106",
                "transfer_status": "已入库",
            }
        ],
        schedules=[],
        experiments=[
            {
                "task_code": "SYLU-2026-04-106",
                "experiment_code": "SYLU-2026-04-106-A",
                "experiment_name": "A实验",
                "status": "待排程",
                "unscheduled_since": "",
            }
        ],
        experiment_trays=[],
        experiment_samples=[
            {
                "task_code": "SYLU-2026-04-106",
                "experiment_code": "SYLU-2026-04-106-A",
                "sample_code": "SYLU-2026-04-106-SP-001",
            },
            {
                "task_code": "SYLU-2026-04-106",
                "experiment_code": "SYLU-2026-04-106-A",
                "sample_code": "SYLU-2026-04-106-SP-002",
            },
        ],
        samples=[
            {
                "code": "SYLU-2026-04-106-SP-001",
                "task_code": "SYLU-2026-04-106",
                "status": "已入库",
                "updated_at": "2026-03-17T11:00:00Z",
                "history": [
                    {
                        "action": "任务已确认入库",
                        "time": "2026-03-17T09:30:00Z",
                    }
                ],
            },
            {
                "code": "SYLU-2026-04-106-SP-002",
                "task_code": "SYLU-2026-04-106",
                "status": "已入库",
                "updated_at": "2026-03-17T12:00:00Z",
                "history": [
                    {
                        "action": "任务已确认入库",
                        "time": "2026-03-17T09:00:00Z",
                    }
                ],
            },
        ],
    )

    assert experiments[0]["unscheduled_since"] == "2026-03-17T17:00:00+08:00"
    assert repaired == {
        "SYLU-2026-04-106-A": datetime(2026, 3, 17, 17, 0),
    }


def test_backfill_missing_unscheduled_since_skips_formal_schedule_and_started_experiment() -> None:
    experiments, repaired = backfill_missing_unscheduled_since(
        tasks=[
            {"code": "TASK-001", "transfer_status": "已入库"},
            {"code": "TASK-002", "transfer_status": "已入库"},
        ],
        schedules=[
            {
                "task_code": "TASK-001",
                "experiment_code": "TASK-001-A",
                "device": "冲击一室",
                "status": "已排程",
            }
        ],
        experiments=[
            {
                "task_code": "TASK-001",
                "experiment_code": "TASK-001-A",
                "experiment_name": "A实验",
                "status": "待排程",
                "unscheduled_since": "",
            },
            {
                "task_code": "TASK-002",
                "experiment_code": "TASK-002-A",
                "experiment_name": "A实验",
                "status": "实验进行中",
                "unscheduled_since": "",
            },
        ],
        experiment_trays=[],
        experiment_samples=[],
        samples=[
            {
                "code": "TASK-001-SP-001",
                "task_code": "TASK-001",
                "status": "已入库",
                "updated_at": "2026-03-17T10:00:00Z",
                "history": [{"action": "任务已确认入库", "time": "2026-03-17T09:00:00Z"}],
            },
            {
                "code": "TASK-002-SP-001",
                "task_code": "TASK-002",
                "status": "已入库",
                "updated_at": "2026-03-17T10:00:00Z",
                "history": [{"action": "任务已确认入库", "time": "2026-03-17T09:00:00Z"}],
            },
        ],
    )

    assert [experiment["unscheduled_since"] for experiment in experiments] == ["", ""]
    assert repaired == {}


def test_experiment_mapping_normalizes_legacy_running_status() -> None:
    storage_experiment = {
        "id": "experiment-2",
        "task_code": "SYLU-2026-04-106",
        "experiment_code": "SYLU-2026-04-106-B",
        "experiment_name": "B实验",
        "required_device": "振动试验",
        "priority": "中",
        "planned_hours": 2,
        "status": "实验中",
        "created_at": "2026-03-17T09:30:00Z",
        "updated_at": "2026-03-17T09:35:00Z",
    }

    insert_row = build_experiment_insert_row(storage_experiment)
    storage_item = build_storage_experiment_item(
        {
            **insert_row,
            "experiment_id": 9,
        }
    )

    assert insert_row["experiment_status"] == "实验进行中"
    assert storage_item["status"] == "实验进行中"


def test_experiment_mapping_normalizes_legacy_completed_statuses() -> None:
    storage_experiment = {
        "id": "experiment-3",
        "task_code": "SYLU-2026-04-106",
        "experiment_code": "SYLU-2026-04-106-C",
        "experiment_name": "C实验",
        "required_device": "振动试验",
        "priority": "中",
        "planned_hours": 2,
        "status": "实验完成",
        "created_at": "2026-03-17T09:30:00Z",
        "updated_at": "2026-03-17T09:35:00Z",
    }

    insert_row = build_experiment_insert_row(storage_experiment)
    storage_item = build_storage_experiment_item(
        {
            **insert_row,
            "experiment_id": 10,
        }
    )

    assert insert_row["experiment_status"] == "实验已完成"
    assert storage_item["status"] == "实验已完成"


def test_parse_experiment_event_detail_extracts_experiment_name_and_status() -> None:
    parsed = parse_experiment_event_detail(
        "SYLU-2026-03-002 / 盐雾试验 / 实验已完成",
        "SYLU-2026-03-002",
    )

    assert parsed == {
        "experiment_name": "盐雾试验",
        "status": "实验已完成",
    }


def test_derive_experiment_status_map_uses_schedule_and_history_progress() -> None:
    experiments = [
        {"experiment_no": "SYLU-2026-03-002-A", "task_no": "SYLU-2026-03-002", "experiment_name": "盐雾试验"},
        {"experiment_no": "SYLU-2026-03-002-B", "task_no": "SYLU-2026-03-002", "experiment_name": "高低温湿热试验"},
        {"experiment_no": "SYLU-2026-03-002-C", "task_no": "SYLU-2026-03-002", "experiment_name": "振动试验"},
    ]
    schedules = [
        {"schedule_id": 1, "task_no": "SYLU-2026-03-002", "experiment_no": "SYLU-2026-03-002-A", "schedule_status": "已排程"},
        {"schedule_id": 2, "task_no": "SYLU-2026-03-002", "experiment_no": "SYLU-2026-03-002-B", "schedule_status": "已排程"},
        {"schedule_id": 3, "task_no": "SYLU-2026-03-002", "experiment_no": "SYLU-2026-03-002-C", "schedule_status": "已排程"},
    ]
    experiment_samples = [
        {"experiment_no": "SYLU-2026-03-002-A", "sample_no": "SP-001"},
        {"experiment_no": "SYLU-2026-03-002-A", "sample_no": "SP-002"},
        {"experiment_no": "SYLU-2026-03-002-B", "sample_no": "SP-005"},
        {"experiment_no": "SYLU-2026-03-002-C", "sample_no": "SP-001"},
    ]
    sample_events = [
        {"sample_no": "SP-001", "task_no": "SYLU-2026-03-002", "detail": "SYLU-2026-03-002 / 盐雾试验 / 实验已完成"},
        {"sample_no": "SP-002", "task_no": "SYLU-2026-03-002", "detail": "SYLU-2026-03-002 / 盐雾试验 / 实验已完成"},
        {"sample_no": "SP-005", "task_no": "SYLU-2026-03-002", "detail": "SYLU-2026-03-002 / 高低温湿热试验 / 实验中"},
    ]

    assert derive_experiment_status_map(experiments, schedules, experiment_samples, sample_events) == {
        "SYLU-2026-03-002-A": "实验已完成",
        "SYLU-2026-03-002-B": "实验进行中",
        "SYLU-2026-03-002-C": "已排程",
    }


def test_derive_experiment_status_map_keeps_completed_status_without_history_detail() -> None:
    experiments = [
        {
            "experiment_no": "SYLU-2026-03-008-A",
            "task_no": "SYLU-2026-03-008",
            "experiment_name": "盐雾试验",
            "experiment_status": "实验已完成",
        }
    ]
    schedules = [
        {
            "schedule_id": 1,
            "task_no": "SYLU-2026-03-008",
            "experiment_no": "SYLU-2026-03-008-A",
            "schedule_status": "实验已完成",
        }
    ]
    experiment_samples = [
        {"experiment_no": "SYLU-2026-03-008-A", "sample_no": "SP-001"},
    ]

    assert derive_experiment_status_map(experiments, schedules, experiment_samples, []) == {
        "SYLU-2026-03-008-A": "实验已完成",
    }


def test_derive_experiment_status_map_reopens_stale_completed_batch_when_run_trays_are_incomplete() -> None:
    experiments = [
        {
            "experiment_no": "SYLU-2026-06-001-A",
            "task_no": "SYLU-2026-06-001",
            "experiment_name": "盐雾试验",
            "experiment_status": "实验已完成",
        }
    ]
    schedules = [
        {
            "schedule_id": 1,
            "task_no": "SYLU-2026-06-001",
            "experiment_no": "SYLU-2026-06-001-A",
            "schedule_status": "实验已完成",
        }
    ]
    experiment_trays = [
        {"task_no": "SYLU-2026-06-001", "experiment_no": "SYLU-2026-06-001-A", "tray_no": "TP-001"},
        {"task_no": "SYLU-2026-06-001", "experiment_no": "SYLU-2026-06-001-A", "tray_no": "TP-002"},
    ]
    experiment_run_trays = [
        {
            "task_no": "SYLU-2026-06-001",
            "experiment_no": "SYLU-2026-06-001-A",
            "tray_no": "TP-001",
            "run_tray_status": "实验已完成",
        }
    ]

    assert derive_experiment_status_map(
        experiments,
        schedules,
        [],
        [],
        experiment_trays=experiment_trays,
        experiment_run_trays=experiment_run_trays,
    ) == {
        "SYLU-2026-06-001-A": "实验进行中",
    }


def test_derive_task_status_map_keeps_task_running_once_any_experiment_started_or_completed() -> None:
    tasks = [{"task_no": "SYLU-2026-03-002"}]
    experiments = [
        {"experiment_no": "SYLU-2026-03-002-A", "task_no": "SYLU-2026-03-002"},
        {"experiment_no": "SYLU-2026-03-002-B", "task_no": "SYLU-2026-03-002"},
        {"experiment_no": "SYLU-2026-03-002-C", "task_no": "SYLU-2026-03-002"},
    ]
    experiment_status_map = {
        "SYLU-2026-03-002-A": "实验已完成",
        "SYLU-2026-03-002-B": "已排程",
        "SYLU-2026-03-002-C": "实验进行中",
    }

    assert derive_task_status_map(tasks, experiments, experiment_status_map) == {
        "SYLU-2026-03-002": "任务进行中",
    }


def test_normalize_storage_payload_normalizes_legacy_status_variants() -> None:
    normalized = normalize_storage_payload(
        {
            "mes.tasks": [{"code": "TASK-001", "status": "实验中"}, {"code": "TASK-002", "status": "实验已经完成"}],
            "mes.experiments": [
                {"task_code": "TASK-001", "experiment_code": "TASK-001-A", "status": "实验中"},
                {"task_code": "TASK-002", "experiment_code": "TASK-002-A", "status": "实验完成"},
            ],
            "mes.schedules": [
                {"task_code": "TASK-001", "experiment_code": "TASK-001-A", "status": "实验中"},
                {"task_code": "TASK-002", "experiment_code": "TASK-002-A", "status": "实验已经完成"},
            ],
            "mes.samples": [
                {
                    "code": "TASK-001-SP-001",
                    "task_code": "TASK-001",
                    "status": "实验中",
                    "flow_status": "实验完成",
                    "trays": [{"tray_code": "TASK-001-TP-001", "status": "实验中", "quantity": 1}],
                    "history": [{"action": "开始实验", "detail": "TASK-001 / A实验 / 实验中", "status": "实验完成"}],
                }
            ],
        }
    )

    assert [task["status"] for task in normalized["mes.tasks"]] == ["任务进行中", "任务已完成"]
    experiment_status_by_code = {experiment["experiment_code"]: experiment["status"] for experiment in normalized["mes.experiments"]}
    assert experiment_status_by_code["TASK-001-A"] == "实验进行中"
    assert experiment_status_by_code["TASK-002-A"] == "实验已完成"
    assert [schedule["status"] for schedule in normalized["mes.schedules"]] == ["实验进行中", "实验已完成"]
    assert normalized["mes.samples"][0]["status"] == "实验进行中"
    assert normalized["mes.samples"][0]["flow_status"] == "实验已完成"
    assert normalized["mes.samples"][0]["trays"][0]["status"] == "实验进行中"
    assert normalized["mes.samples"][0]["history"][0]["status"] == "实验已完成"
    assert normalized["mes.samples"][0]["history"][0]["detail"] == "TASK-001 / A实验 / 实验进行中"


def test_experiment_tray_mapping_round_trip_preserves_assignment_keys() -> None:
    relation = {
        "id": "rel-1",
        "task_code": "SYLU-2026-04-106",
        "experiment_code": "SYLU-2026-04-106-A",
        "tray_code": "SYLU-2026-04-106-TP-001",
        "created_at": "2026-03-17T09:40:00Z",
        "updated_at": "2026-03-17T09:41:00Z",
    }

    insert_row = build_experiment_tray_insert_row(relation)

    assert insert_row["experiment_no"] == "SYLU-2026-04-106-A"
    assert insert_row["task_no"] == "SYLU-2026-04-106"
    assert insert_row["tray_no"] == "SYLU-2026-04-106-TP-001"

    storage_item = build_storage_experiment_tray_item(
        {
            **insert_row,
            "relation_id": 11,
        }
    )

    assert storage_item["experiment_code"] == "SYLU-2026-04-106-A"
    assert storage_item["task_code"] == "SYLU-2026-04-106"
    assert storage_item["tray_code"] == "SYLU-2026-04-106-TP-001"


def test_experiment_sample_mapping_round_trip_preserves_assignment_keys() -> None:
    relation = {
        "id": "rel-2",
        "task_code": "SYLU-2026-04-106",
        "experiment_code": "SYLU-2026-04-106-A",
        "sample_code": "SYLU-2026-04-106-SP-001",
        "created_at": "2026-03-17T09:42:00Z",
        "updated_at": "2026-03-17T09:43:00Z",
    }

    insert_row = build_experiment_sample_insert_row(relation)

    assert insert_row["experiment_no"] == "SYLU-2026-04-106-A"
    assert insert_row["task_no"] == "SYLU-2026-04-106"
    assert insert_row["sample_no"] == "SYLU-2026-04-106-SP-001"

    storage_item = build_storage_experiment_sample_item(
        {
            **insert_row,
            "relation_id": 12,
        }
    )

    assert storage_item["experiment_code"] == "SYLU-2026-04-106-A"
    assert storage_item["task_code"] == "SYLU-2026-04-106"
    assert storage_item["sample_code"] == "SYLU-2026-04-106-SP-001"


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


def test_device_mapping_round_trip_preserves_three_safety_statuses() -> None:
    for status in ["可用", "维修", "保养"]:
        insert_row = build_device_insert_row(
            {
                "code": f"设备-{status}",
                "name": f"设备-{status}",
                "status": status,
            }
        )

        storage_item = build_storage_device_item(insert_row)

        assert insert_row["status"] == status
        assert storage_item["status"] == status


def test_device_mapping_round_trip_preserves_maintenance_plan_fields() -> None:
    insert_row = build_device_insert_row(
        {
            "code": "盐雾试验室",
            "name": "盐雾试验室",
            "status": "维修",
            "maintenance_start_at": "2026-05-29T09:00:00",
            "maintenance_end_at": "2026-05-29T12:00:00",
            "maintenance_type": "计划维修",
            "maintenance_note": "提前更换喷嘴",
        }
    )

    storage_item = build_storage_device_item(insert_row)

    assert insert_row["maintenance_start_at"].strftime("%Y-%m-%d %H:%M:%S") == "2026-05-29 09:00:00"
    assert insert_row["maintenance_end_at"].strftime("%Y-%m-%d %H:%M:%S") == "2026-05-29 12:00:00"
    assert insert_row["maintenance_type"] == "计划维修"
    assert insert_row["maintenance_note"] == "提前更换喷嘴"
    assert storage_item["maintenance_start_at"] == "2026-05-29T09:00:00+08:00"
    assert storage_item["maintenance_end_at"] == "2026-05-29T12:00:00+08:00"
    assert storage_item["maintenance_type"] == "计划维修"
    assert storage_item["maintenance_note"] == "提前更换喷嘴"


def test_replace_devices_persists_maintenance_plan_fields() -> None:
    backend = MySQLMesStorageBackend(
        MySQLConnectionSettings(host="127.0.0.1", port=3306, user="root", password="", database="mes"),
        _DummySnapshotRepository(),
    )

    class _CaptureCursor:
        def __init__(self) -> None:
            self.execute_calls = []
            self.executemany_calls = []

        def execute(self, sql, params=None):
            self.execute_calls.append((" ".join(str(sql).split()), params))

        def executemany(self, sql, rows):
            self.executemany_calls.append((" ".join(str(sql).split()), list(rows)))

    cursor = _CaptureCursor()

    backend._replace_devices(
        cursor,
        [
            {
                "code": "盐雾试验室",
                "name": "盐雾试验室",
                "status": "保养",
                "maintenance_start_at": "2026-05-29T09:00:00",
                "maintenance_end_at": "2026-05-29T12:00:00",
                "maintenance_type": "计划保养",
                "maintenance_note": "喷嘴保养",
            }
        ],
    )

    insert_sql, rows = cursor.executemany_calls[0]
    row = rows[0]
    assert "maintenance_start_at, maintenance_end_at, maintenance_type" in insert_sql
    assert "maintenance_note = VALUES(maintenance_note)" in insert_sql
    assert row["maintenance_start_at"].strftime("%Y-%m-%d %H:%M:%S") == "2026-05-29 09:00:00"
    assert row["maintenance_end_at"].strftime("%Y-%m-%d %H:%M:%S") == "2026-05-29 12:00:00"
    assert row["maintenance_type"] == "计划保养"
    assert row["maintenance_note"] == "喷嘴保养"


def test_stream_mapping_round_trip_formats_quality_and_reported_flag() -> None:
    storage_stream = {
        "id": "stream-1",
        "task_code": "SYLU-2026-04-103",
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
        "code": "SYLU-2026-04-103-SP-001",
        "task_code": "SYLU-2026-04-103",
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
                "tray_code": "SYLU-2026-04-103-TP-001",
                "sample_code": "SYLU-2026-04-103-SP-001",
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

    assert insert_row["sample_no"] == "SYLU-2026-04-103-SP-001"
    assert insert_row["sample_status"] == "到货"
    assert insert_row["quantity"] == 2
    assert insert_row["task_no"] == "SYLU-2026-04-103"
    assert STORAGE_MARKER in insert_row["remark"]

    storage_item = build_storage_sample_item(
        {
            **insert_row,
            "sample_id": 7,
            "sample_name": "SYLU-2026-04-103-SP-001",
        },
        tray_rows=storage_sample["trays"],
        event_rows=storage_sample["history"],
    )

    assert storage_item["id"] == "SYLU-2026-04-103-SP-001"
    assert storage_item["owner"] == "张三"
    assert storage_item["remark"] == "样品备注"
    assert storage_item["trays"][0]["tray_code"] == "SYLU-2026-04-103-TP-001"
    assert storage_item["history"][0]["action"] == "样品登记"
    assert storage_item["history"][0]["detail"] == "登记完成"


def test_task_round_trip_includes_tray_codes_from_tray_rows() -> None:
    tray_rows = [
        {"task_no": "SYLU-2026-04-103", "tray_no": "SYLU-2026-04-103-TP-002"},
        {"task_no": "SYLU-2026-04-103", "tray_no": "SYLU-2026-04-103-TP-001"},
        {"task_no": "OTHER", "tray_no": "OTHER-TP-001"},
    ]

    tray_map = build_storage_task_tray_codes(tray_rows)
    storage_item = build_storage_task_item(
        {
            "task_no": "SYLU-2026-04-103",
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
        tray_codes=tray_map.get("SYLU-2026-04-103"),
    )

    assert storage_item["tray_codes"] == ["SYLU-2026-04-103-TP-001", "SYLU-2026-04-103-TP-002"]


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


def test_build_storage_sample_item_preserves_tray_status() -> None:
    storage_item = build_storage_sample_item(
        {
            "sample_id": 101,
            "sample_no": "SYLU-2026-03-002-SP-005",
            "task_no": "SYLU-2026-03-002",
            "sample_type": "",
            "batch_no": "",
            "arrival_time": None,
            "quantity": 1,
            "storage_condition": "",
            "barcode_no": "",
            "location_desc": "盐雾试验室",
            "sample_status": "实验进行中",
            "flow_status": "实验进行中",
            "remark": f"{STORAGE_MARKER}:SAMPLE:{{\"owner\":\"\",\"remark\":\"\"}}",
            "created_at": "2026-03-17 09:00:00",
            "updated_at": "2026-03-17 09:00:00",
        },
        tray_rows=[
            {
                "id": "SYLU-2026-03-002-TP-002",
                "tray_code": "SYLU-2026-03-002-TP-002",
                "sample_code": "SYLU-2026-03-002-SP-005",
                "quantity": 1,
                "status": "实验进行中",
                "created_at": "2026-03-17 09:00:00",
                "updated_at": "2026-03-17 09:00:00",
            }
        ],
    )

    assert storage_item["trays"][0]["status"] == "实验进行中"


def test_build_storage_sample_item_recovers_tray_target_lab_from_dispatch_history() -> None:
    storage_item = build_storage_sample_item(
        {
            "sample_id": 103,
            "sample_no": "SYLU-2026-06-021-SP-002",
            "task_no": "SYLU-2026-06-021",
            "sample_type": "",
            "batch_no": "",
            "arrival_time": None,
            "quantity": 1,
            "storage_condition": "",
            "barcode_no": "",
            "location_desc": "温度冲击一室",
            "sample_status": "送至实验室",
            "flow_status": "送至实验室",
            "remark": f"{STORAGE_MARKER}:SAMPLE:{{\"owner\":\"\",\"remark\":\"\"}}",
            "created_at": "2026-06-03 18:50:19",
            "updated_at": "2026-06-03 18:51:57",
        },
        tray_rows=[
            {
                "id": "SYLU-2026-06-021-TP-002",
                "tray_code": "SYLU-2026-06-021-TP-002",
                "sample_code": "SYLU-2026-06-021-SP-002",
                "quantity": 1,
                "status": "送至实验室",
                "created_at": "2026-06-03 18:50:35",
                "updated_at": "2026-06-03 18:51:57",
            }
        ],
        event_rows=[
            {
                "event_id": 406912,
                "event_time": "2026-06-03 18:51:57",
                "action_type": "送至实验室",
                "location_desc": "温度冲击一室",
                "sample_status": "送至实验室",
                "detail": "SYLU-2026-06-021-TP-002 -> 温度冲击一室",
            },
            {
                "event_id": 406913,
                "event_time": "2026-06-03 18:51:28",
                "action_type": "任务已确认入库",
                "location_desc": "接驳区",
                "sample_status": "到货",
                "detail": "SYLU-2026-06-021",
            },
        ],
    )

    assert storage_item["trays"][0]["target_lab"] == "温度冲击一室"


def test_build_storage_sample_item_does_not_recover_target_lab_for_completed_tray() -> None:
    storage_item = build_storage_sample_item(
        {
            "sample_id": 104,
            "sample_no": "SYLU-2026-06-002-SP-001",
            "task_no": "SYLU-2026-06-002",
            "sample_type": "",
            "batch_no": "",
            "arrival_time": None,
            "quantity": 1,
            "storage_condition": "",
            "barcode_no": "",
            "location_desc": "振动一室",
            "sample_status": "实验已完成",
            "flow_status": "实验已完成",
            "remark": f"{STORAGE_MARKER}:SAMPLE:{{\"owner\":\"\",\"remark\":\"\"}}",
            "created_at": "2026-06-04 01:00:00",
            "updated_at": "2026-06-04 01:04:34",
        },
        tray_rows=[
            {
                "id": "SYLU-2026-06-002-TP-001",
                "tray_code": "SYLU-2026-06-002-TP-001",
                "sample_code": "SYLU-2026-06-002-SP-001",
                "quantity": 1,
                "status": "实验已完成",
                "created_at": "2026-06-04 01:00:00",
                "updated_at": "2026-06-04 01:04:34",
            }
        ],
        event_rows=[
            {
                "event_id": 406914,
                "event_time": "2026-06-04 01:03:00",
                "action_type": "送至实验室",
                "location_desc": "振动一室",
                "sample_status": "送至实验室",
                "detail": "SYLU-2026-06-002-TP-001 -> 振动一室",
            },
            {
                "event_id": 406915,
                "event_time": "2026-06-04 01:04:34",
                "action_type": "实验完成",
                "location_desc": "振动一室",
                "sample_status": "实验已完成",
                "detail": "SYLU-2026-06-002 / 振动试验 / 实验已完成",
            },
        ],
    )

    assert storage_item["trays"][0]["status"] == "实验已完成"
    assert storage_item["trays"][0]["target_lab"] == ""


def test_build_storage_sample_item_preserves_fixture_ready_marker() -> None:
    storage_item = build_storage_sample_item(
        {
            "sample_id": 102,
            "sample_no": "SYLU-2026-03-003-SP-001",
            "task_no": "SYLU-2026-03-003",
            "sample_type": "",
            "batch_no": "",
            "arrival_time": None,
            "quantity": 1,
            "storage_condition": "",
            "barcode_no": "",
            "location_desc": "盐雾试验室",
            "sample_status": "工装夹具安装",
            "flow_status": "工装夹具安装",
            "remark": f"{STORAGE_MARKER}:SAMPLE:{{\"owner\":\"\",\"remark\":\"\"}}",
            "created_at": "2026-03-17 09:00:00",
            "updated_at": "2026-03-17 09:00:00",
        },
        tray_rows=[
            {
                "id": "SYLU-2026-03-003-TP-001",
                "tray_code": "SYLU-2026-03-003-TP-001",
                "sample_code": "SYLU-2026-03-003-SP-001",
                "quantity": 1,
                "status": "工装夹具安装",
                "fixture_ready": True,
                "created_at": "2026-03-17 09:00:00",
                "updated_at": "2026-03-17 09:00:00",
            }
        ],
    )

    assert storage_item["trays"][0]["fixture_ready"] is True
    assert storage_item["trays"][0]["fixtureReady"] is True


def test_load_samples_marks_task_trays_fixture_ready_from_mqtt_event() -> None:
    backend = MySQLMesStorageBackend(
        MySQLConnectionSettings(host="127.0.0.1", port=3306, user="root", password="", database="mes"),
        _DummySnapshotRepository(),
    )

    class _Cursor:
        def __init__(self) -> None:
            self._result = []

        def execute(self, statement, params=None):
            if "FROM biz_sample s" in statement:
                self._result = [
                    {
                        "sample_id": 102,
                        "sample_no": "SYLU-2026-03-003-SP-001",
                        "task_no": "SYLU-2026-03-003",
                        "sample_type": "",
                        "batch_no": "",
                        "arrival_time": None,
                        "quantity": 1,
                        "storage_condition": "",
                        "barcode_no": "",
                        "location_desc": "盐雾试验室",
                        "sample_status": "工装夹具安装",
                        "flow_status": "工装夹具安装",
                        "remark": f"{STORAGE_MARKER}:SAMPLE:{{\"owner\":\"\",\"remark\":\"\"}}",
                        "created_at": "2026-03-17 09:00:00",
                        "updated_at": "2026-03-17 09:00:00",
                    }
                ]
            elif "FROM biz_tray_item" in statement:
                self._result = [
                    {
                        "sample_id": 102,
                        "task_no": "SYLU-2026-03-003",
                        "tray_code": "SYLU-2026-03-003-TP-001",
                        "sample_code": "SYLU-2026-03-003-SP-001",
                        "quantity": 1,
                        "status": "工装夹具安装",
                        "test_state": "",
                        "tray_status": "",
                        "created_at": "2026-03-17 09:00:00",
                        "updated_at": "2026-03-17 09:00:00",
                    }
                ]
            elif "FROM biz_experiment_event" in statement:
                self._result = [{"task_no": "SYLU-2026-03-003", "event_time": "2026-03-17 09:05:00"}]
            elif "FROM biz_sample_event" in statement:
                self._result = []
            else:
                self._result = []

        def fetchall(self):
            return self._result

    samples = backend._load_samples(_Cursor())

    assert samples[0]["trays"][0]["fixture_ready"] is True
    assert samples[0]["trays"][0]["fixtureReady"] is True


def test_load_samples_ignores_stale_fixture_ready_before_latest_install() -> None:
    backend = MySQLMesStorageBackend(
        MySQLConnectionSettings(host="127.0.0.1", port=3306, user="root", password="", database="mes"),
        _DummySnapshotRepository(),
    )

    class _Cursor:
        def __init__(self) -> None:
            self._result = []

        def execute(self, statement, params=None):
            normalized = " ".join(str(statement).split())
            if "FROM biz_sample s" in normalized:
                self._result = [
                    {
                        "sample_id": 102,
                        "sample_no": "SYLU-2026-03-003-SP-001",
                        "task_no": "SYLU-2026-03-003",
                        "sample_type": "",
                        "batch_no": "",
                        "arrival_time": None,
                        "quantity": 1,
                        "storage_condition": "",
                        "barcode_no": "",
                        "location_desc": "盐雾试验室",
                        "sample_status": "工装夹具安装",
                        "flow_status": "工装夹具安装",
                        "remark": f"{STORAGE_MARKER}:SAMPLE:{{\"owner\":\"\",\"remark\":\"\"}}",
                        "created_at": "2026-03-17 09:00:00",
                        "updated_at": "2026-03-17 09:10:00",
                    }
                ]
            elif "FROM biz_tray_item" in normalized:
                self._result = [
                    {
                        "sample_id": 102,
                        "task_no": "SYLU-2026-03-003",
                        "tray_code": "SYLU-2026-03-003-TP-001",
                        "sample_code": "SYLU-2026-03-003-SP-001",
                        "quantity": 1,
                        "status": "工装夹具安装",
                        "test_state": "",
                        "tray_status": "",
                        "created_at": "2026-03-17 09:00:00",
                        "updated_at": "2026-03-17 09:10:00",
                    }
                ]
            elif "FROM biz_experiment_event" in normalized:
                self._result = [{"task_no": "SYLU-2026-03-003", "event_time": "2026-03-17 09:05:00"}]
            elif "FROM biz_sample_event" in normalized and "action_type IN" in normalized:
                self._result = [{"task_no": "SYLU-2026-03-003", "event_time": "2026-03-17 09:10:00"}]
            elif "FROM biz_sample_event" in normalized:
                self._result = []
            else:
                self._result = []

        def fetchall(self):
            return self._result

    samples = backend._load_samples(_Cursor())

    assert samples[0]["trays"][0]["fixture_ready"] is False
    assert samples[0]["trays"][0]["fixtureReady"] is False


def test_replace_samples_persists_real_tray_item_status() -> None:
    backend = MySQLMesStorageBackend(
        MySQLConnectionSettings(host="127.0.0.1", port=3306, user="root", password="", database="mes"),
        _DummySnapshotRepository(),
    )

    class _CaptureCursor:
        def __init__(self) -> None:
            self._result = []
            self.executemany_calls = []

        def execute(self, sql, params=None):
            statement = " ".join(str(sql).split())
            if "SELECT task_id, task_no FROM biz_task" in statement:
                self._result = [{"task_id": 1, "task_no": "SYLU-2026-03-002"}]
            elif "SELECT sample_id, sample_no, task_id FROM biz_sample" in statement:
                self._result = [{"sample_id": 11, "sample_no": "SYLU-2026-03-002-SP-005", "task_id": 1}]
            elif "SELECT tray_id, tray_no FROM biz_tray" in statement:
                self._result = [{"tray_id": 21, "tray_no": "SYLU-2026-03-002-TP-002"}]
            else:
                self._result = []

        def executemany(self, sql, rows):
            self.executemany_calls.append((" ".join(str(sql).split()), list(rows)))

        def fetchall(self):
            return self._result

    cursor = _CaptureCursor()
    backend._replace_samples(
        cursor,
        [
            {
                "code": "SYLU-2026-03-002-SP-005",
                "task_code": "SYLU-2026-03-002",
                "status": "实验进行中",
                "flow_status": "实验进行中",
                "location": "盐雾试验室",
                "updated_at": "2026-04-09T10:22:30Z",
                "trays": [
                    {
                        "tray_code": "SYLU-2026-03-002-TP-002",
                        "sample_code": "SYLU-2026-03-002-SP-005",
                        "quantity": 1,
                        "status": "实验进行中",
                        "updated_at": "2026-04-09T10:22:30Z",
                    }
                ],
                "history": [],
            }
        ],
    )

    tray_item_call = next(
        rows
        for sql, rows in cursor.executemany_calls
        if "INSERT INTO biz_tray_item" in sql
    )
    assert tray_item_call[0]["status"] == "实验进行中"


def test_replace_samples_persists_fixture_ready_as_compat_experiment_event() -> None:
    backend = MySQLMesStorageBackend(
        MySQLConnectionSettings(host="127.0.0.1", port=3306, user="root", password="", database="mes"),
        _DummySnapshotRepository(),
    )

    class _CaptureCursor:
        def __init__(self) -> None:
            self._result = []
            self.execute_calls = []
            self.executemany_calls = []

        def execute(self, sql, params=None):
            statement = " ".join(str(sql).split())
            self.execute_calls.append((statement, params))
            if "SELECT task_id, task_no FROM biz_task" in statement:
                self._result = [{"task_id": 1, "task_no": "SYLU-2026-03-003"}]
            elif "SELECT sample_id, sample_no, task_id FROM biz_sample" in statement:
                self._result = [{"sample_id": 11, "sample_no": "SYLU-2026-03-003-SP-001", "task_id": 1}]
            elif "SELECT tray_id, tray_no FROM biz_tray" in statement:
                self._result = [{"tray_id": 21, "tray_no": "SYLU-2026-03-003-TP-001"}]
            else:
                self._result = []

        def executemany(self, sql, rows):
            self.executemany_calls.append((" ".join(str(sql).split()), list(rows)))

        def fetchall(self):
            return self._result

    cursor = _CaptureCursor()
    backend._replace_samples(
        cursor,
        [
            {
                "code": "SYLU-2026-03-003-SP-001",
                "task_code": "SYLU-2026-03-003",
                "status": "工装夹具安装",
                "flow_status": "工装夹具安装",
                "location": "盐雾试验室",
                "updated_at": "2026-04-09T10:22:30Z",
                "trays": [
                    {
                        "tray_code": "SYLU-2026-03-003-TP-001",
                        "sample_code": "SYLU-2026-03-003-SP-001",
                        "quantity": 1,
                        "status": "工装夹具安装",
                        "fixture_ready": True,
                        "updated_at": "2026-04-09T10:22:30Z",
                    }
                ],
                "history": [],
            }
        ],
    )

    assert any("DELETE FROM biz_experiment_event" in sql for sql, _params in cursor.execute_calls)
    fixture_event_rows = next(
        rows
        for sql, rows in cursor.executemany_calls
        if "INSERT INTO biz_experiment_event" in sql
    )
    assert fixture_event_rows[0]["task_no"] == "SYLU-2026-03-003"
    assert fixture_event_rows[0]["message_id"] == "FRONTEND_STORAGE:FIXTURE_READY:SYLU-2026-03-003"
    assert "frontend_fixture_countdown" in fixture_event_rows[0]["payload_json"]


def test_replace_schedules_backfills_task_id_from_task_no() -> None:
    backend = MySQLMesStorageBackend(
        MySQLConnectionSettings(host="127.0.0.1", port=3306, user="root", password="", database="mes"),
        _DummySnapshotRepository(),
    )

    class _CaptureCursor:
        def __init__(self) -> None:
            self._result = []
            self.executemany_calls = []

        def execute(self, sql, params=None):
            statement = " ".join(str(sql).split())
            if "SELECT task_id, task_no FROM biz_task" in statement:
                self._result = [{"task_id": 12773, "task_no": "SYLU-2026-03-002"}]
            else:
                self._result = []

        def executemany(self, sql, rows):
            self.executemany_calls.append((" ".join(str(sql).split()), list(rows)))

        def fetchall(self):
            return self._result

    cursor = _CaptureCursor()
    backend._replace_schedules(
        cursor,
        [
            {
                "id": "schedule-1",
                "task_code": "SYLU-2026-03-002",
                "experiment_code": "SYLU-2026-03-002-A",
                "device": "盐雾试验室",
                "start_at": "2026-04-09T10:05:38Z",
                "end_at": "2026-04-09T13:35:38Z",
                "status": "已排程",
            }
        ],
    )

    schedule_call = next(
        rows
        for sql, rows in cursor.executemany_calls
        if "INSERT INTO biz_schedule" in sql
    )
    assert schedule_call[0]["task_id"] == 12773


def test_replace_schedules_backfills_lab_id_from_device_name() -> None:
    backend = MySQLMesStorageBackend(
        MySQLConnectionSettings(host="127.0.0.1", port=3306, user="root", password="", database="mes"),
        _DummySnapshotRepository(),
    )

    class _CaptureCursor:
        def __init__(self) -> None:
            self._result = []
            self.executed = []
            self.executemany_calls = []

        def execute(self, sql, params=None):
            statement = " ".join(str(sql).split())
            self.executed.append((statement, params))
            if "SELECT task_id, task_no FROM biz_task" in statement:
                self._result = [{"task_id": 12773, "task_no": "SYLU-2026-03-002"}]
            elif "SELECT lab_id, lab_code, lab_name FROM md_lab" in statement:
                self._result = [{"lab_id": 9, "lab_code": "LAB_SALT", "lab_name": "盐雾试验室"}]
            else:
                self._result = []

        def executemany(self, sql, rows):
            self.executemany_calls.append((" ".join(str(sql).split()), list(rows)))

        def fetchall(self):
            return self._result

    cursor = _CaptureCursor()
    backend._replace_schedules(
        cursor,
        [
            {
                "id": "schedule-1",
                "task_code": "SYLU-2026-03-002",
                "experiment_code": "SYLU-2026-03-002-A",
                "device": "盐雾试验室",
                "start_at": "2026-04-09T10:05:38Z",
                "end_at": "2026-04-09T13:35:38Z",
                "status": "已排程",
            }
        ],
    )

    assert any("FROM md_lab" in statement for statement, _params in cursor.executed)
    schedule_sql, schedule_call = next(
        (sql, rows)
        for sql, rows in cursor.executemany_calls
        if "INSERT INTO biz_schedule" in sql
    )
    assert "%(lab_id)s" in schedule_sql
    assert "lab_id = VALUES(lab_id)" in schedule_sql
    assert schedule_call[0]["lab_id"] == 9


def test_normalize_legacy_status_columns_converts_stored_status_to_arrived() -> None:
    backend = MySQLMesStorageBackend(
        MySQLConnectionSettings(host="127.0.0.1", port=3306, user="root", password="", database="mes"),
        _DummySnapshotRepository(),
    )

    class _CaptureCursor:
        def __init__(self) -> None:
            self.executed = []

        def execute(self, sql, params=None):
            self.executed.append((" ".join(str(sql).split()), params))

    cursor = _CaptureCursor()
    backend._normalize_legacy_status_columns(cursor)

    assert any("transfer_status" in statement and params[:2] == ("已入库", "到货") for statement, params in cursor.executed)
    assert any("UPDATE biz_sample" in statement and params[:2] == ("已入库", "到货") for statement, params in cursor.executed)
    assert any("UPDATE biz_tray" in statement and params[:2] == ("已入库", "到货") for statement, params in cursor.executed)
    assert any("UPDATE biz_tray_item" in statement and params == ("到货", "已入库") for statement, params in cursor.executed)


def test_normalize_storage_payload_preserves_existing_task_codes_without_auto_migration() -> None:
    payload = {
        "mes.tasks": [
            {
                "id": "task-1",
                "code": "SYLU-2026-04-105",
                "name": "高低温湿热试验-批次E",
                "test_type": "高低温湿热试验",
                "created_at": "2026-03-05T09:00:00",
            }
        ],
        "mes.samples": [
            {
                "id": "sample-1",
                "code": "SYLU-2026-04-105-SP-001",
                "task_code": "SYLU-2026-04-105",
                "created_at": "2026-03-05T09:05:00",
                "trays": [
                    {
                        "tray_code": "SYLU-2026-04-105-TP-001",
                        "sample_code": "SYLU-2026-04-105-SP-001",
                        "quantity": 1,
                    }
                ],
            }
        ],
        "mes.schedules": [
            {
                "id": "schedule-1",
                "task_code": "SYLU-2026-04-105",
                "experiment_code": "SYLU-2026-04-105-A",
                "device": "高低温实验室",
            }
        ],
        "mes.experiments": [],
        "mes.experiment_trays": [
            {
                "task_code": "SYLU-2026-04-105",
                "experiment_code": "SYLU-2026-04-105-A",
                "tray_code": "SYLU-2026-04-105-TP-001",
            }
        ],
        "mes.streams": [{"id": "stream-1", "task_code": "SYLU-2026-04-105"}],
    }

    normalized = normalize_storage_payload(payload)

    assert normalized["mes.tasks"][0]["code"] == "SYLU-2026-04-105"
    assert normalized["mes.tasks"][0]["experiment_codes"] == ["SYLU-2026-04-105-A"]
    assert normalized["mes.samples"][0]["code"] == "SYLU-2026-04-105-SP-001"
    assert normalized["mes.samples"][0]["trays"][0]["tray_code"] == "SYLU-2026-04-105-TP-001"
    assert normalized["mes.schedules"][0]["experiment_code"] == "SYLU-2026-04-105-A"
    assert normalized["mes.experiment_trays"][0]["tray_code"] == "SYLU-2026-04-105-TP-001"
    assert normalized["mes.streams"][0]["task_code"] == "SYLU-2026-04-105"
    assert normalized["mes.experiments"][0]["experiment_name"] == "高低温湿热试验"
    assert len(normalized["mes.experiments"]) == 1
    assert normalized["mes.meta"]["schema_version"] == 2


def test_experiment_and_schedule_rows_round_trip_with_existing_task_codes() -> None:
    normalized = normalize_storage_payload(
        {
            "mes.tasks": [
                {
                    "id": "task-1",
                    "code": "SYLU-2026-04-106",
                    "name": "四综合任务",
                    "test_type": "四综合试验",
                    "created_at": "2026-03-17T09:00:00",
                }
            ],
            "mes.experiments": [
                {
                    "id": "experiment-1",
                    "task_code": "SYLU-2026-04-106",
                    "experiment_code": "SYLU-2026-04-106-A",
                    "experiment_name": "A实验",
                    "required_device": "四综合试验",
                    "status": "待排程",
                }
            ],
            "mes.schedules": [
                {
                    "id": "schedule-1",
                    "task_code": "SYLU-2026-04-106",
                    "experiment_code": "SYLU-2026-04-106-A",
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

    assert experiment_row["task_no"] == "SYLU-2026-04-106"
    assert experiment_row["experiment_no"] == "SYLU-2026-04-106-A"
    assert experiment_item["experiment_name"] == "四综合试验"
    assert schedule_row["experiment_no"] == "SYLU-2026-04-106-A"
    assert schedule_item["task_code"] == "SYLU-2026-04-106"
    assert schedule_item["experiment_code"] == "SYLU-2026-04-106-A"


def test_experiment_run_row_round_trips_tray_scoped_batch_times() -> None:
    normalized = normalize_storage_payload(
        {
            "mes.experiment_runs": [
                {
                    "id": "run-001",
                    "run_no": "run-001",
                    "schedule_id": "schedule-001",
                    "task_code": "SYLU-2026-05-001",
                    "experiment_code": "SYLU-2026-05-001-B",
                    "device": "盐雾试验室",
                    "planned_hours": 3.5,
                    "status": "实验中",
                    "started_at": "2026-06-01T09:40:00+08:00",
                    "planned_end_at": "2026-06-01T13:10:00+08:00",
                    "ended_at": "",
                    "tray_codes": ["SYLU-2026-05-001-TP-002"],
                }
            ]
        }
    )

    row = build_experiment_run_insert_row(normalized["mes.experiment_runs"][0])
    item = build_storage_experiment_run_item(row, tray_codes=["SYLU-2026-05-001-TP-002"])

    assert row["run_no"] == "run-001"
    assert row["schedule_no"] == "schedule-001"
    assert row["experiment_no"] == "SYLU-2026-05-001-B"
    assert row["run_status"] == "实验进行中"
    assert item["schedule_id"] == "schedule-001"
    assert item["tray_codes"] == ["SYLU-2026-05-001-TP-002"]
    assert item["started_at"] == "2026-06-01T09:40:00+08:00"
    assert item["planned_end_at"] == "2026-06-01T13:10:00+08:00"


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


class _TrackingConnection(_DummyConnection):
    def __init__(self) -> None:
        self.commit_count = 0

    def commit(self):
        self.commit_count += 1
        return None


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
    monkeypatch.setattr(backend, "_replace_experiment_runs", lambda cursor, rows: order.append("experiment_runs"))
    monkeypatch.setattr(backend, "_replace_experiment_trays", lambda cursor, rows: order.append("experiment_trays"))
    monkeypatch.setattr(backend, "_replace_experiment_samples", lambda cursor, rows: order.append("experiment_samples"))
    monkeypatch.setattr(backend, "_backfill_schedule_task_ids", lambda cursor: order.append("schedule_task_ids"))
    monkeypatch.setattr(backend, "_sync_progress_statuses", lambda cursor: order.append("progress_statuses"))

    backend._write_many_internal(
        {
            "mes.tasks": [{"code": "SYLU-2026-03-001"}],
            "mes.samples": [{"code": "SYLU-2026-03-001-SP-001", "task_code": "SYLU-2026-03-001"}],
            "mes.experiments": [{"experiment_code": "SYLU-2026-03-001-A", "task_code": "SYLU-2026-03-001"}],
            "mes.experiment_runs": [{"id": "run-001", "experiment_code": "SYLU-2026-03-001-A", "task_code": "SYLU-2026-03-001"}],
            "mes.experiment_trays": [{"experiment_code": "SYLU-2026-03-001-A", "task_code": "SYLU-2026-03-001", "tray_code": "SYLU-2026-03-001-TP-001"}],
            "mes.experiment_samples": [{"experiment_code": "SYLU-2026-03-001-A", "task_code": "SYLU-2026-03-001", "sample_code": "SYLU-2026-03-001-SP-001"}],
        }
    )

    assert order == [
        "tasks:False",
        "samples",
        "experiments",
        "experiment_runs",
        "experiment_trays",
        "experiment_samples",
        "tasks:True",
        "schedule_task_ids",
        "progress_statuses",
    ]


def test_sync_progress_statuses_reads_existing_run_tray_relation_column(monkeypatch) -> None:
    backend = MySQLMesStorageBackend(
        MySQLConnectionSettings(host="127.0.0.1", port=3306, user="root", password="", database="mes"),
        _DummySnapshotRepository(),
    )

    class SyncCursor:
        def __init__(self):
            self.result = []

        def execute(self, sql, params=None):
            normalized_sql = " ".join(str(sql).split())
            assert "run_tray_id" not in normalized_sql
            if "FROM biz_task" in normalized_sql:
                self.result = [{"task_id": 1, "task_no": "TASK-001", "task_status": "进行中"}]
            elif "FROM biz_experiment_run_tray" in normalized_sql:
                self.result = [
                    {
                        "relation_id": 10,
                        "run_no": "RUN-001",
                        "task_no": "TASK-001",
                        "experiment_no": "TASK-001-A",
                        "tray_no": "TP-001",
                        "run_tray_status": "实验已完成",
                    }
                ]
            elif "FROM biz_experiment_tray" in normalized_sql:
                self.result = [{"relation_id": 20, "experiment_no": "TASK-001-A", "task_no": "TASK-001", "tray_no": "TP-001"}]
            elif "FROM biz_experiment_sample" in normalized_sql or "FROM biz_sample_event" in normalized_sql:
                self.result = []
            elif "FROM biz_experiment" in normalized_sql:
                self.result = [
                    {
                        "experiment_id": 1,
                        "experiment_no": "TASK-001-A",
                        "task_id": 1,
                        "task_no": "TASK-001",
                        "experiment_name": "盐雾试验",
                        "experiment_status": "实验进行中",
                    }
                ]
            elif "FROM biz_schedule" in normalized_sql:
                self.result = [
                    {
                        "schedule_id": 1,
                        "task_id": 1,
                        "task_no": "TASK-001",
                        "experiment_no": "TASK-001-A",
                        "schedule_status": "实验进行中",
                    }
                ]
            else:
                self.result = []

        def fetchall(self):
            return self.result

        def executemany(self, _sql, _params):
            return None

    monkeypatch.setattr(backend, "_normalize_legacy_status_columns", lambda cursor: None)

    backend._sync_progress_statuses(SyncCursor())


def test_read_all_backfills_missing_unscheduled_since_and_persists(monkeypatch) -> None:
    backend = MySQLMesStorageBackend(
        MySQLConnectionSettings(host="127.0.0.1", port=3306, user="root", password="", database="mes"),
        _DummySnapshotRepository(),
    )
    connection = _TrackingConnection()
    repaired = {}

    monkeypatch.setattr(backend, "_ensure_schema_extensions", lambda: None)
    monkeypatch.setattr(backend, "_connect", lambda: connection)
    monkeypatch.setattr(backend, "_normalize_legacy_status_columns", lambda cursor: None)
    monkeypatch.setattr(
        backend,
        "_load_tasks",
        lambda cursor: [{"code": "TASK-001", "transfer_status": "已入库"}],
    )
    monkeypatch.setattr(backend, "_load_schedules", lambda cursor: [])
    monkeypatch.setattr(backend, "_load_devices", lambda cursor: [])
    monkeypatch.setattr(backend, "_load_streams", lambda cursor: [])
    monkeypatch.setattr(
        backend,
        "_load_samples",
        lambda cursor: [
            {
                "code": "TASK-001-SP-001",
                "task_code": "TASK-001",
                "status": "已入库",
                "updated_at": "2026-03-17T10:00:00Z",
                "history": [{"action": "任务已确认入库", "time": "2026-03-17T09:00:00Z"}],
            }
        ],
    )
    monkeypatch.setattr(
        backend,
        "_load_experiments",
        lambda cursor: [
            {
                "task_code": "TASK-001",
                "experiment_code": "TASK-001-A",
                "experiment_name": "A实验",
                "status": "待排程",
                "unscheduled_since": "",
            }
        ],
    )
    monkeypatch.setattr(backend, "_load_experiment_trays", lambda cursor: [])
    monkeypatch.setattr(backend, "_load_experiment_runs", lambda cursor: [])
    monkeypatch.setattr(backend, "_load_experiment_samples", lambda cursor: [])
    monkeypatch.setattr(
        backend,
        "_update_experiment_unscheduled_since",
        lambda cursor, values: repaired.update(values),
    )

    snapshot = backend.read_all()

    assert snapshot["mes.experiments"][0]["unscheduled_since"] == "2026-03-17T17:00:00+08:00"
    assert repaired == {"TASK-001-A": datetime(2026, 3, 17, 17, 0)}
    assert connection.commit_count == 2


def test_write_many_does_not_clear_unrelated_experiment_tray_assignments(monkeypatch) -> None:
    backend = MySQLMesStorageBackend(
        MySQLConnectionSettings(host="127.0.0.1", port=3306, user="root", password="", database="mes"),
        _DummySnapshotRepository(),
    )

    writes = {}
    monkeypatch.setattr(backend, "_write_many_internal", lambda updates: writes.update(updates))

    backend.write_many(
        {
            "mes.samples": [
                {
                    "code": "SYLU-2026-03-006-SP-001",
                    "task_code": "SYLU-2026-03-006",
                    "status": "已分配",
                }
            ]
        }
    )

    assert list(writes.keys()) == ["mes.samples"]
    assert writes["mes.samples"] == [
        {
            "code": "SYLU-2026-03-006-SP-001",
            "task_code": "SYLU-2026-03-006",
            "status": "已分配",
        }
    ]


def test_reset_demo_data_preserves_devices_when_writing_mysql_backend(monkeypatch, tmp_path) -> None:
    backend = MySQLMesStorageBackend(
        MySQLConnectionSettings(host="127.0.0.1", port=3306, user="root", password="", database="mes"),
        _DummySnapshotRepository(),
    )

    existing_snapshot = normalize_storage_payload(
        {
            "mes.tasks": [{"code": "SYLU-2026-03-999", "name": "旧任务"}],
            "mes.samples": [{"code": "SYLU-2026-03-999-SP-001", "task_code": "SYLU-2026-03-999"}],
            "mes.experiments": [{"experiment_code": "SYLU-2026-03-999-A", "task_code": "SYLU-2026-03-999"}],
            "mes.schedules": [{"id": "legacy-schedule", "task_code": "SYLU-2026-03-999", "experiment_code": "SYLU-2026-03-999-A"}],
            "mes.experiment_trays": [{"task_code": "SYLU-2026-03-999", "experiment_code": "SYLU-2026-03-999-A", "tray_code": "SYLU-2026-03-999-TP-001"}],
            "mes.experiment_samples": [{"task_code": "SYLU-2026-03-999", "experiment_code": "SYLU-2026-03-999-A", "sample_code": "SYLU-2026-03-999-SP-001"}],
            "mes.streams": [{"task_code": "SYLU-2026-03-999", "status": "采集中"}],
            "mes.conflicts": [{"id": "legacy-conflict", "task_code": "SYLU-2026-03-999"}],
            "mes.devices": [{"id": "device-1", "code": "LAB-001", "name": "振动一室"}],
        }
    )
    writes = {}

    monkeypatch.setattr(backend, "read_all", lambda: existing_snapshot)
    monkeypatch.setattr(backend, "write_many", lambda updates: writes.update(updates))

    snapshot = reset_demo_data(backend)

    assert snapshot["mes.devices"] == [{"id": "device-1", "code": "LAB-001", "name": "振动一室"}]
    assert writes["mes.devices"] == [{"id": "device-1", "code": "LAB-001", "name": "振动一室"}]
    assert len(writes["mes.tasks"]) == 20
    assert writes["mes.schedules"] == []
    assert writes["mes.experiment_trays"] == []
    assert writes["mes.experiment_samples"] == []

