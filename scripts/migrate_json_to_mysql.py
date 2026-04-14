from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.core.config import settings
from app.core.mysql_storage_backend import (
    SAMPLE_META_PREFIX,
    STORAGE_MARKER,
    TRAY_META_PREFIX,
    MySQLConnectionSettings,
    MySQLMesStorageBackend,
)
from app.core.storage_backend import normalize_storage_payload
from app.db.mysql_snapshot import MySQLSnapshotRepository
from scripts.init_mysql_storage import (
    _connect_mysql,
    ensure_database_exists,
    ensure_required_base_tables_exist,
    initialize_mysql_storage,
)


def create_mysql_storage_backend() -> MySQLMesStorageBackend:
    connection_settings = MySQLConnectionSettings(
        host=settings.MYSQL_HOST,
        port=settings.MYSQL_PORT,
        user=settings.MYSQL_USER,
        password=settings.MYSQL_PASSWORD,
        database=settings.MYSQL_DATABASE,
    )
    return MySQLMesStorageBackend(
        connection_settings,
        MySQLSnapshotRepository(connection_settings),
        bootstrap_storage=None,
    )


def _load_json_snapshot(source_path: Path) -> dict[str, Any]:
    if not source_path.exists():
        raise FileNotFoundError(f"JSON snapshot file does not exist: {source_path}")
    payload = json.loads(source_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("JSON snapshot must contain an object payload")
    return normalize_storage_payload(payload)


def _table_exists(cursor, table_name: str) -> bool:
    cursor.execute(
        """
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_schema = %s AND table_name = %s
        """,
        (settings.MYSQL_DATABASE, table_name),
    )
    row = cursor.fetchone()
    return bool(row and row[0])


def ensure_mysql_target_is_empty() -> None:
    ensure_database_exists()
    ensure_required_base_tables_exist()

    with _connect_mysql(database=settings.MYSQL_DATABASE) as connection:
        with connection.cursor() as cursor:
            if _table_exists(cursor, "app_storage_snapshot"):
                cursor.execute("SELECT COUNT(*) FROM app_storage_snapshot")
                row = cursor.fetchone()
                if row and row[0]:
                    raise RuntimeError("Target MySQL storage already contains managed MES data")

            cursor.execute("SELECT COUNT(*) FROM biz_task WHERE source_system = %s", (STORAGE_MARKER,))
            task_row = cursor.fetchone()
            if task_row and task_row[0]:
                raise RuntimeError("Target MySQL storage already contains managed MES data")

            cursor.execute("SELECT COUNT(*) FROM biz_schedule WHERE schedule_type = %s", (STORAGE_MARKER,))
            schedule_row = cursor.fetchone()
            if schedule_row and schedule_row[0]:
                raise RuntimeError("Target MySQL storage already contains managed MES data")

            cursor.execute("SELECT COUNT(*) FROM biz_experiment")
            experiment_row = cursor.fetchone()
            if experiment_row and experiment_row[0]:
                raise RuntimeError("Target MySQL storage already contains managed MES data")

            cursor.execute("SELECT COUNT(*) FROM biz_experiment_tray")
            experiment_tray_row = cursor.fetchone()
            if experiment_tray_row and experiment_tray_row[0]:
                raise RuntimeError("Target MySQL storage already contains managed MES data")

            cursor.execute("SELECT COUNT(*) FROM biz_experiment_sample")
            experiment_sample_row = cursor.fetchone()
            if experiment_sample_row and experiment_sample_row[0]:
                raise RuntimeError("Target MySQL storage already contains managed MES data")

            cursor.execute("SELECT COUNT(*) FROM md_equipment WHERE manufacturer = %s", (STORAGE_MARKER,))
            device_row = cursor.fetchone()
            if device_row and device_row[0]:
                raise RuntimeError("Target MySQL storage already contains managed MES data")

            cursor.execute("SELECT COUNT(*) FROM biz_data_stream WHERE remark = %s", (STORAGE_MARKER,))
            stream_row = cursor.fetchone()
            if stream_row and stream_row[0]:
                raise RuntimeError("Target MySQL storage already contains managed MES data")

            cursor.execute("SELECT COUNT(*) FROM biz_sample WHERE remark LIKE %s", (f"{SAMPLE_META_PREFIX}%",))
            sample_row = cursor.fetchone()
            if sample_row and sample_row[0]:
                raise RuntimeError("Target MySQL storage already contains managed MES data")

            cursor.execute("SELECT COUNT(*) FROM biz_tray WHERE remark = %s", (TRAY_META_PREFIX,))
            tray_row = cursor.fetchone()
            if tray_row and tray_row[0]:
                raise RuntimeError("Target MySQL storage already contains managed MES data")

            cursor.execute("SELECT COUNT(*) FROM biz_tray_item")
            tray_item_row = cursor.fetchone()
            if tray_item_row and tray_item_row[0]:
                raise RuntimeError("Target MySQL storage already contains managed MES data")

            cursor.execute("SELECT COUNT(*) FROM biz_sample_event")
            sample_event_row = cursor.fetchone()
            if sample_event_row and sample_event_row[0]:
                raise RuntimeError("Target MySQL storage already contains managed MES data")


def migrate_json_to_mysql(source_path: Path) -> dict[str, Any]:
    payload = _load_json_snapshot(source_path)
    ensure_mysql_target_is_empty()
    initialize_mysql_storage(seed_demo=False)
    backend = create_mysql_storage_backend()
    backend.write_many(payload)
    return {
        "source_path": str(source_path),
        "task_count": len(payload.get("mes.tasks", [])),
        "sample_count": len(payload.get("mes.samples", [])),
        "experiment_count": len(payload.get("mes.experiments", [])),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Explicitly import mes_store.json data into MySQL.")
    parser.add_argument(
        "--source",
        required=True,
        help="Path to the JSON snapshot file to import.",
    )
    args = parser.parse_args(argv)
    summary = migrate_json_to_mysql(Path(args.source))
    print(
        f"JSON import complete: source={summary['source_path']}, tasks={summary['task_count']}, "
        f"samples={summary['sample_count']}, experiments={summary['experiment_count']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
