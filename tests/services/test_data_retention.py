from __future__ import annotations

import asyncio
from datetime import datetime
import json
from types import SimpleNamespace

from app.services.data_retention import (
    DataRetentionPolicy,
    DataRetentionRuntime,
    DataRetentionService,
    RETENTION_LOCK_NAME,
    prune_staging_events,
)


def event(event_id: str, time: str, **overrides):
    return {
        "id": event_id,
        "task_code": "TASK-1",
        "tray_code": "TRAY-1",
        "room": "staging",
        "action": "stock_in",
        "time": time,
        **overrides,
    }


def test_prune_staging_events_keeps_latest_workflow_marker_for_each_state_key():
    events = [
        event("old-stock-in", "2025-01-01 08:00:00"),
        event("latest-stock-in", "2025-02-01 08:00:00"),
        event("latest-stock-out", "2025-01-02 08:00:00", action="stock_out"),
        event(
            "latest-appearance-exp-a",
            "2025-01-03 08:00:00",
            room="appearance",
            action="stock_out",
            appearance_phase="pre_experiment",
            target_experiment_code="EXP-A",
        ),
        event(
            "latest-appearance-exp-b",
            "2025-01-04 08:00:00",
            room="appearance",
            action="stock_out",
            appearance_phase="pre_experiment",
            target_experiment_code="EXP-B",
        ),
        {"id": "old-unscoped", "action": "diagnostic", "time": "2025-01-01 07:00:00"},
    ]

    retained, deleted = prune_staging_events(
        events,
        cutoff=datetime(2025, 3, 1),
        batch_size=20,
    )

    assert deleted == 2
    assert [item["id"] for item in retained] == [
        "latest-stock-in",
        "latest-stock-out",
        "latest-appearance-exp-a",
        "latest-appearance-exp-b",
    ]


def test_prune_staging_events_is_batched_idempotent_and_preserves_invalid_time():
    events = [
        event("old-1", "2025-01-01 08:00:00"),
        event("old-2", "2025-01-02 08:00:00"),
        event("latest", "2025-03-01 08:00:00"),
        {"id": "invalid-time", "task_code": "TASK-X", "tray_code": "TRAY-X", "time": "unknown"},
    ]

    retained, deleted = prune_staging_events(
        events,
        cutoff=datetime(2025, 4, 1),
        batch_size=1,
    )
    retained_again, deleted_again = prune_staging_events(
        retained,
        cutoff=datetime(2025, 4, 1),
        batch_size=10,
    )
    final, final_deleted = prune_staging_events(
        retained_again,
        cutoff=datetime(2025, 4, 1),
        batch_size=10,
    )

    assert deleted == 1
    assert deleted_again == 1
    assert final_deleted == 0
    assert [item["id"] for item in final] == ["latest", "invalid-time"]


def test_prune_staging_events_allows_returned_task_markers_to_age_out():
    events = [
        event("returned-latest", "2025-01-01 08:00:00", task_code="TASK-RETURNED"),
        event("active-old", "2025-01-01 08:00:00", task_code="TASK-ACTIVE"),
        event("active-latest", "2025-02-01 08:00:00", task_code="TASK-ACTIVE"),
    ]

    retained, deleted = prune_staging_events(
        events,
        cutoff=datetime(2025, 3, 1),
        batch_size=20,
        protected_task_codes={"TASK-ACTIVE"},
    )

    assert deleted == 2
    assert [item["id"] for item in retained] == ["active-latest"]


def test_prune_staging_events_ages_out_latest_markers_for_returned_tasks_only():
    events = [
        event("active-latest", "2025-01-01 08:00:00", task_code="TASK-A", tray_code="TRAY-A"),
        event("returned-latest", "2025-01-01 09:00:00", task_code="TASK-B", tray_code="TRAY-B"),
    ]

    retained, deleted = prune_staging_events(
        events,
        cutoff=datetime(2026, 1, 1),
        batch_size=10,
        protected_task_codes={"TASK-A"},
    )

    assert deleted == 1
    assert [item["id"] for item in retained] == ["active-latest"]


class SqlCursor:
    def __init__(self):
        self.executed = []
        self.rowcount = 2

    def execute(self, sql, params):
        self.executed.append((" ".join(sql.split()), params))


class StagingCursor(SqlCursor):
    def __init__(self, payload):
        super().__init__()
        self.payload = payload

    def fetchone(self):
        return (self.payload,)

    def fetchall(self):
        return [("TASK-1",)]


def test_relational_cleanup_sql_limits_batches_and_preserves_latest_state_rows():
    cursor = SqlCursor()
    cutoff = datetime(2025, 1, 1)

    mq_deleted = DataRetentionService._delete_mq_batch(cursor, cutoff, 50)
    event_deleted = DataRetentionService._delete_experiment_event_batch(cursor, cutoff, 50)

    assert mq_deleted == 2
    assert event_deleted == 2
    mq_sql, mq_params = cursor.executed[0]
    event_sql, event_params = cursor.executed[1]
    assert "LIMIT %s" in mq_sql
    assert "newer.task_no <=> old.task_no" in mq_sql
    assert "newer.message_type <=> old.message_type" in mq_sql
    assert "newer.message_log_id > old.message_log_id" in mq_sql
    assert mq_params == (cutoff, 50)
    assert "LIMIT %s" in event_sql
    assert "newer.task_no <=> old.task_no" in event_sql
    assert "newer.event_type <=> old.event_type" in event_sql
    assert "newer.experiment_event_id > old.experiment_event_id" in event_sql
    assert event_params == (cutoff, 50)


def test_staging_cleanup_protects_active_tasks_and_updates_returned_history():
    class Cursor:
        rowcount = 0

        def __init__(self):
            self.current = None
            self.updated_payload = None

        def execute(self, sql, params):
            if "FROM biz_task" in sql:
                self.current = [("TASK-A",)]
            elif "SELECT payload_json" in sql:
                self.current = [(json.dumps([
                    event("active", "2025-01-01 08:00:00", task_code="TASK-A", tray_code="TRAY-A"),
                    event("returned", "2025-01-01 09:00:00", task_code="TASK-B", tray_code="TRAY-B"),
                ]),)]
            elif "UPDATE app_storage_snapshot" in sql:
                self.updated_payload = json.loads(params[0])

        def fetchall(self):
            rows = self.current or []
            self.current = None
            return rows

        def fetchone(self):
            rows = self.current or []
            self.current = None
            return rows[0] if rows else None

    cursor = Cursor()

    deleted = DataRetentionService._delete_staging_batch(cursor, datetime(2026, 1, 1), 10)

    assert deleted == 1
    assert [item["id"] for item in cursor.updated_payload] == ["active"]


def test_staging_cleanup_locks_snapshot_row_and_updates_only_after_batched_prune():
    cursor = StagingCursor(
        '[{"id":"old","task_code":"TASK-1","tray_code":"TRAY-1",'
        '"action":"stock_in","time":"2025-01-01 08:00:00"},'
        '{"id":"latest","task_code":"TASK-1","tray_code":"TRAY-1",'
        '"action":"stock_in","time":"2025-02-01 08:00:00"}]'
    )

    deleted = DataRetentionService._delete_staging_batch(
        cursor,
        datetime(2025, 3, 1),
        1,
    )

    assert deleted == 1
    active_task_sql, active_task_params = cursor.executed[0]
    select_sql, select_params = cursor.executed[1]
    update_sql, update_params = cursor.executed[2]
    assert "FROM biz_task" in active_task_sql
    assert active_task_params == ("厂家收回", "厂家收回")
    assert "FOR UPDATE" in select_sql
    assert select_params == ("mes.staging_events",)
    assert "UPDATE app_storage_snapshot" in update_sql
    assert "latest" in update_params[0]
    assert "old" not in update_params[0]


class LockCursor:
    rowcount = 0

    def __init__(self, connection):
        self.connection = connection
        self.current = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql, params):
        self.connection.executed.append((" ".join(sql.split()), params))
        if "GET_LOCK" in sql:
            self.current = (self.connection.lock_result,)
        elif "RELEASE_LOCK" in sql:
            self.current = (1,)

    def fetchone(self):
        return self.current


class LockConnection:
    def __init__(self, lock_result=1):
        self.lock_result = lock_result
        self.executed = []
        self.commits = 0
        self.rollbacks = 0

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self):
        return LockCursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class CleanupSequence:
    def __init__(self, *results):
        self.results = list(results)
        self.calls = []

    def __call__(self, _cursor, cutoff, batch_size):
        self.calls.append((cutoff, batch_size))
        return self.results.pop(0) if self.results else 0


def test_run_once_uses_cross_process_lock_commits_small_batches_and_reports_counts():
    connection = LockConnection()
    policy = DataRetentionPolicy(90, 365, 365, batch_size=2, max_batches_per_run=3)
    service = DataRetentionService(
        policy,
        connection_factory=lambda: connection,
        clock=lambda: datetime(2026, 1, 1),
    )
    service._delete_mq_batch = CleanupSequence(2, 2, 1)
    service._delete_experiment_event_batch = CleanupSequence(0)
    service._delete_staging_batch = CleanupSequence(1)

    result = service.run_once()

    assert result["acquired"] is True
    assert result["deleted"] == {
        "biz_mq_message_log": 5,
        "biz_experiment_event": 0,
        "mes.staging_events": 1,
    }
    assert result["batches"] == {
        "biz_mq_message_log": 3,
        "biz_experiment_event": 0,
        "mes.staging_events": 1,
    }
    assert connection.commits == 5
    assert connection.rollbacks == 0
    assert connection.executed[0] == ("SELECT GET_LOCK(%s, 0)", (RETENTION_LOCK_NAME,))
    assert connection.executed[-1] == ("SELECT RELEASE_LOCK(%s)", (RETENTION_LOCK_NAME,))


def test_run_once_skips_when_another_process_holds_database_lock():
    connection = LockConnection(lock_result=0)
    service = DataRetentionService(
        DataRetentionPolicy(90, 365, 365, batch_size=10, max_batches_per_run=1),
        connection_factory=lambda: connection,
    )

    result = service.run_once()

    assert result["acquired"] is False
    assert result["skippedReason"] == "database-lock-active"
    assert not any("RELEASE_LOCK" in sql for sql, _params in connection.executed)


def test_runtime_exposes_last_result_and_cumulative_deleted_counts():
    class Service:
        def run_once(self):
            return {"acquired": True, "deleted": {"biz_mq_message_log": 3}}

    settings = SimpleNamespace(
        RETENTION_ENABLED=True,
        STORAGE_BACKEND="mysql",
        RETENTION_STARTUP_DELAY_SECONDS=60,
        RETENTION_INTERVAL_SECONDS=3600,
    )
    runtime = DataRetentionRuntime(settings, service=Service())

    result = asyncio.run(runtime.run_now())
    status = runtime.status()

    assert result["deleted"]["biz_mq_message_log"] == 3
    assert status["running"] is False
    assert status["lastError"] == ""
    assert status["totalDeleted"] == {"biz_mq_message_log": 3}
    assert status["lastStartedAt"]
    assert status["lastFinishedAt"]


def test_runtime_start_and_stop_are_idempotent_without_running_cleanup_early():
    class Service:
        def __init__(self):
            self.calls = 0

        def run_once(self):
            self.calls += 1
            return {"acquired": True, "deleted": {}}

    async def scenario():
        service = Service()
        settings = SimpleNamespace(
            RETENTION_ENABLED=True,
            STORAGE_BACKEND="mysql",
            RETENTION_STARTUP_DELAY_SECONDS=3600,
            RETENTION_INTERVAL_SECONDS=3600,
        )
        runtime = DataRetentionRuntime(settings, service=service)
        runtime.start()
        runtime.start()
        assert runtime.status()["scheduled"] is True
        await runtime.stop()
        await runtime.stop()
        assert runtime.status()["scheduled"] is False
        assert service.calls == 0

    asyncio.run(scenario())
