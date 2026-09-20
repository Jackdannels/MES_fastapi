import json
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import RLock

import pytest

from app.services.resource_inventory import (
    CONSUMPTION_PER_RUN, RESOURCE_LEDGER_KEY, append_replenishment, capture_resource_consumption,
    consumption_entries, inventory_summary, merge_consumption, read_inventory, replenish_inventory,
)


def start(resource="盐雾", run="RUN-1", trays=("TRAY-1",)):
    return {
        "mes.experiment_runs": [{"run_no": run, "task_code": "T", "experiment_code": "E", "device": f"{resource}试验室", "status": "实验进行中", "started_at": "2026-09-20 10:00:00", "tray_codes": list(trays)}],
        "mes.experiment_run_trays": [{"run_no": run, "task_code": "T", "experiment_code": "E", "tray_code": tray, "started_at": "2026-09-20 10:00:00"} for tray in trays],
    }


def consume(updates):
    return consumption_entries(updates["mes.experiment_runs"], updates["mes.experiment_run_trays"])


def balance(ledger, resource="salt"):
    return next(row for row in inventory_summary(ledger)["resources"] if row["key"] == resource)


@pytest.mark.parametrize("name,key", [("盐雾", "salt"), ("霉菌", "mold")])
def test_consumables_do_not_return_on_completion_cancellation_or_deleted_workflow(name, key):
    updates = start(name, trays=("T1", "T2", "T1"))
    ledger = merge_consumption([], consume(updates))
    expected = 100 - CONSUMPTION_PER_RUN[key]
    assert len(ledger) == 1
    assert balance(ledger, key)["remaining"] == expected
    for status in ("实验进行中", "实验暂停", "实验已完成", "实验已取消", "设备故障试验取消", "实验异常终止"):
        updates["mes.experiment_runs"][0]["status"] = status
        ledger = merge_consumption(ledger, consume(updates))
        assert balance(ledger, key)["remaining"] == expected
    assert balance(merge_consumption(ledger, []), key)["remaining"] == expected
    ledger = merge_consumption(ledger, consume(start(name, run="RUN-2", trays=("T1",))))
    assert balance(ledger, key)["remaining"] == expected - CONSUMPTION_PER_RUN[key]


@pytest.mark.parametrize("name,key,cost", [("盐雾", "salt", 10), ("霉菌", "mold", 20)])
def test_fixed_recipe_does_not_multiply_by_trays_or_sample_count(name, key, cost):
    for tray_count in (1, 2, 10, 100):
        ledger = consume(start(name, trays=tuple(f"T{i}" for i in range(tray_count))))
        assert len(ledger) == 1
        assert balance(ledger, key)["used"] == cost
        assert balance(ledger, key)["remaining"] == 100 - cost


def test_legacy_per_tray_entries_are_preserved_without_double_charging_replayed_runs():
    legacy = [{"id": json.dumps(["salt", "RUN-1", tray]), "kind": "consume", "resource": "salt", "run_no": "RUN-1", "tray_code": tray, "quantity": 1} for tray in ("T1", "T2")]
    merged = merge_consumption(legacy, consume(start(trays=("T1", "T2", "T3"))))
    assert merged == legacy
    assert balance(merged)["remaining"] == 98
    merged = merge_consumption(merged, consume(start(run="RUN-2")))
    assert balance(merged)["remaining"] == 88


def test_pending_or_unstarted_and_other_labs_do_not_consume():
    updates = start()
    updates["mes.experiment_runs"][0]["status"] = "实验准备就绪"
    assert consume(updates) == []
    updates = start("高低温湿热二室")
    assert consume(updates) == []
    updates = start()
    updates["mes.experiment_runs"][0]["started_at"] = ""
    updates["mes.experiment_run_trays"][0]["started_at"] = ""
    assert consume(updates) == []


def test_replenishment_is_additive_idempotent_and_keeps_deficit():
    ledger = [entry for index in range(11) for entry in consume(start(run=f"R{index}"))]
    assert balance(ledger)["remaining"] == 0
    assert balance(ledger)["deficit"] == 10
    args = dict(resource="salt", quantity=20, request_id="same-request", note="batch", operator="central")
    ledger = append_replenishment(ledger, **args)
    assert balance(ledger)["remaining"] == 10
    assert append_replenishment(ledger, **args) == ledger
    with pytest.raises(ValueError):
        append_replenishment(ledger, **{**args, "quantity": 21})
    assert balance(ledger, "mold")["remaining"] == 100


@pytest.mark.parametrize("amount", [0, -1, 1.5, True, "5", 10001])
def test_replenishment_rejects_invalid_quantities(amount):
    with pytest.raises(ValueError):
        append_replenishment([], resource="salt", quantity=amount, request_id="r", note="", operator="a")


class LedgerDatabase:
    """Transactional DB double; SQL lock boundary serializes independent clients."""
    def __init__(self):
        self.payload = None
        self.usage = []
        self.lock = RLock()
        self.sql = []
        self.commits = 0

    def connect(self):
        return LedgerConnection(self)


class LedgerConnection:
    def __init__(self, database):
        self.db = database
        self.pending = None
        self.result = []

    def __enter__(self):
        self.db.lock.acquire()
        self.pending = self.db.payload
        return self

    def __exit__(self, *args):
        self.db.lock.release()

    def cursor(self):
        connection = self
        class CursorContext:
            def __enter__(self): return connection
            def __exit__(self, *args): return False
        return CursorContext()

    def execute(self, sql, params=()):
        sql = " ".join(sql.split())
        self.db.sql.append(sql)
        self.result = []
        if sql.startswith("INSERT INTO app_storage_snapshot"):
            self.pending = self.pending or "[]"
        elif sql.startswith("SELECT payload_json"):
            self.result = [{"payload_json": self.pending}] if self.pending else []
        elif sql.startswith("UPDATE app_storage_snapshot"):
            assert params[1] == RESOURCE_LEDGER_KEY
            self.pending = params[0]
        elif "FROM biz_experiment_run er" in sql:
            self.result = deepcopy(self.db.usage)
        elif "FROM biz_experiment_run WHERE" in sql:
            self.result = [row for row in self.db.usage if row["run_no"] in params]
        else:
            raise AssertionError(f"Unexpected SQL: {sql}")

    def fetchone(self): return self.result[0] if self.result else None
    def fetchall(self): return self.result
    def commit(self): self.db.payload = self.pending; self.db.commits += 1
    def rollback(self): self.pending = self.db.payload


def test_read_only_bootstrap_preserves_historical_consumption_and_commit_captures_it():
    db = LedgerDatabase()
    db.usage = [{"run_no": "OLD", "device_name": "霉菌试验室", "run_status": "实验已完成", "started_at": "2026-09-19 10:00:00", "tray_no": "OLD-T"}]
    with db.connect() as cursor:
        assert read_inventory(cursor)["resources"][1]["remaining"] == 80
    assert db.payload is None  # GET never writes
    with db.connect() as cursor:
        capture_resource_consumption(cursor, start())
        cursor.commit()
    db.usage = []
    with db.connect() as cursor:
        assert [r["remaining"] for r in read_inventory(cursor)["resources"]] == [90, 80]
        capture_resource_consumption(cursor, start())
        cursor.commit()
    assert len([r for r in json.loads(db.payload) if r.get("kind") == "consume"]) == 2
    assert any("FOR UPDATE" in sql for sql in db.sql)


def test_concurrent_refills_and_replayed_starts_do_not_lose_or_duplicate_entries():
    db = LedgerDatabase()
    def perform(index):
        with db.connect() as cursor:
            capture_resource_consumption(cursor, start())
            replenish_inventory(cursor, resource="salt", quantity=10, request_id=str(index % 4), note="", operator="central")
            cursor.commit()
    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(perform, range(20)))
    with db.connect() as cursor:
        result = read_inventory(cursor)
    assert result["resources"][0]["remaining"] == 130
    assert len(result["records"]) == 4


@pytest.mark.parametrize("writer", ["write_many", "write_task_scope", "write_task_allocation_scope"])
def test_mysql_backend_commits_consumption_with_workflow_and_rolls_it_back_on_failure(monkeypatch, writer):
    from app.core import mysql_storage_backend as module
    from app.core.mysql_storage_backend import MySQLMesStorageBackend
    db = LedgerDatabase()
    backend = object.__new__(MySQLMesStorageBackend)
    backend._write_lock = RLock()
    monkeypatch.setattr(backend, "_connect", db.connect)
    monkeypatch.setattr(backend, "_ensure_schema_extensions", lambda: None)
    monkeypatch.setattr(backend, "_backfill_schedule_task_ids", lambda cursor: None)
    monkeypatch.setattr(backend, "_sync_progress_statuses", lambda cursor: None)
    monkeypatch.setattr(backend, "_replace_experiment_runs", lambda cursor, rows, **kwargs: None)
    monkeypatch.setattr(backend, "_replace_tasks", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend, "_replace_task_samples", lambda *args, **kwargs: None)
    updates = {**start(), "mes.tasks": [{"code": "T"}]}
    def write():
        if writer == "write_many": backend.write_many(updates)
        elif writer == "write_task_scope": backend.write_task_scope(updates, task_codes={"T"})
        else: backend.write_task_allocation_scope("T", updates)
    def fail(*args, **kwargs): raise RuntimeError("workflow failed")
    monkeypatch.setattr(backend, "_replace_experiment_run_trays", fail)
    monkeypatch.setattr(module, "replace_task_workflow_relations", fail)
    monkeypatch.setattr(backend, "_replace_task_allocation_relations", fail)
    with pytest.raises(RuntimeError, match="workflow failed"):
        write()
    assert db.payload is None
    monkeypatch.setattr(backend, "_replace_experiment_run_trays", lambda *args: None)
    monkeypatch.setattr(module, "replace_task_workflow_relations", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend, "_replace_task_allocation_relations", lambda *args, **kwargs: None)
    write()
    assert backend.read_resource_inventory()["resources"][0]["remaining"] == 90
    write()
    assert backend.read_resource_inventory()["resources"][0]["remaining"] == 90


def test_system_reset_atomically_clears_usage_refills_records_and_does_not_bootstrap_old_runs(monkeypatch):
    from app.core.mysql_storage_backend import MySQLMesStorageBackend, RELATIONAL_STORAGE_KEYS
    from app.core.demo_data_reset import reset_demo_data
    db = LedgerDatabase()
    backend = object.__new__(MySQLMesStorageBackend)
    backend._write_lock = RLock()
    monkeypatch.setattr(backend, "_connect", db.connect)
    monkeypatch.setattr(backend, "_ensure_schema_extensions", lambda: None)
    monkeypatch.setattr(backend, "_backfill_schedule_task_ids", lambda cursor: None)
    monkeypatch.setattr(backend, "_sync_progress_statuses", lambda cursor: None)
    monkeypatch.setattr(backend, "read_all", lambda: {"mes.devices": []})
    # Keep this test focused on the real reset transaction rather than relational
    # SQL details. Capture persisted workflow arrays alongside the ledger write.
    reset_rows = {}
    for key in RELATIONAL_STORAGE_KEYS:
        name = key.removeprefix("mes.")
        monkeypatch.setattr(backend, f"_replace_{name}", lambda cursor, rows, _key=key, **kw: reset_rows.update({_key: rows}))
    monkeypatch.setattr(backend, "_serialize_snapshot_updates", lambda updates: {})
    with db.connect() as cursor:
        capture_resource_consumption(cursor, start())
        capture_resource_consumption(cursor, start("霉菌", run="M1"))
        replenish_inventory(cursor, resource="salt", quantity=4000, request_id="before-reset", note="", operator="central")
        cursor.commit()
    old_ledger = db.payload
    assert backend.read_resource_inventory()["resources"][0]["remaining"] == 4090
    def fail(*args, **kwargs): raise RuntimeError("reset workflow failed")
    monkeypatch.setattr(backend, "_replace_experiment_runs", fail)
    with pytest.raises(RuntimeError, match="reset workflow failed"):
        reset_demo_data(backend)
    assert db.payload == old_ledger
    monkeypatch.setattr(backend, "_replace_experiment_runs", lambda cursor, rows, **kw: reset_rows.update({"mes.experiment_runs": rows}))
    reset_demo_data(backend)
    assert reset_rows["mes.experiment_runs"] == []
    assert reset_rows["mes.experiment_run_trays"] == []
    assert all(not sample["trays"] for sample in reset_rows["mes.samples"])
    # Even if old relational data is presented by a stale read double, the reset
    # marker prevents the new inventory from re-importing that history.
    db.usage = [{"run_no": "OLD", "device_name": "霉菌试验室", "run_status": "实验已完成", "started_at": "2026-09-19", "tray_no": "OLD-T"}]
    result = backend.read_resource_inventory()
    assert result["records"] == []
    for row in result["resources"]:
        assert (row["remaining"], row["used"], row["replenished"], row["deficit"]) == (100, 0, 0, 0)
    # A reused run identifier in the newly reset system can be charged again.
    with db.connect() as cursor:
        capture_resource_consumption(cursor, start())
        capture_resource_consumption(cursor, start("霉菌", run="M1"))
        cursor.commit()
    assert [row["remaining"] for row in backend.read_resource_inventory()["resources"]] == [90, 80]


def test_read_only_bootstrap_counts_multiple_joined_trays_once_per_run():
    db = LedgerDatabase()
    db.usage = [{"run_no": "OLD", "device_name": "盐雾试验室", "run_status": "实验已完成", "started_at": "2026-09-19", "tray_no": f"T{i}"} for i in range(4)]
    with db.connect() as cursor:
        assert read_inventory(cursor)["resources"][0]["remaining"] == 90
    assert db.payload is None


def test_ordinary_empty_workflow_write_does_not_reset_inventory():
    db = LedgerDatabase()
    with db.connect() as cursor:
        capture_resource_consumption(cursor, start())
        replenish_inventory(cursor, resource="mold", quantity=40, request_id="keep", note="", operator="central")
        cursor.commit()
    original = db.payload
    with db.connect() as cursor:
        capture_resource_consumption(cursor, {"mes.experiment_runs": [], "mes.experiment_run_trays": []})
        cursor.commit()
    assert db.payload == original
