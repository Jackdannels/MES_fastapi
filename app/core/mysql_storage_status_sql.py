from __future__ import annotations

from datetime import datetime
from typing import Any

from app.core.storage_backend import CANONICAL_COMPLETED_STATUS
from app.core.mysql_storage_codecs import STORAGE_MARKER, normalize_text
from app.core.mysql_storage_status import (
    EXPERIMENT_RUNNING_STATUS,
    LEGACY_EXPERIMENT_RUNNING_STATUS,
    LEGACY_TASK_STORED_STATUS,
    TASK_COMPLETED_STATUS,
    TASK_RUNNING_STATUS,
    TASK_STORED_STATUS,
    backfill_missing_unscheduled_since,
    derive_experiment_status_map,
    derive_task_status_map,
)


def backfill_schedule_task_ids(cursor) -> None:
    cursor.execute(
        """
        UPDATE biz_schedule s
        JOIN biz_task t ON t.task_no = s.task_no
        SET s.task_id = t.task_id
        WHERE s.schedule_type = %s
          AND (s.task_id IS NULL OR s.task_id <> t.task_id)
        """,
        (STORAGE_MARKER,),
    )


def normalize_legacy_status_columns(cursor) -> None:
    cursor.execute(
        """
        UPDATE biz_task
        SET task_status = CASE WHEN task_status = %s THEN %s ELSE task_status END,
            transfer_status = CASE WHEN transfer_status = %s THEN %s ELSE transfer_status END
        WHERE task_status = %s
           OR transfer_status = %s
        """,
        (
            LEGACY_TASK_STORED_STATUS,
            TASK_STORED_STATUS,
            LEGACY_TASK_STORED_STATUS,
            TASK_STORED_STATUS,
            LEGACY_TASK_STORED_STATUS,
            LEGACY_TASK_STORED_STATUS,
        ),
    )
    cursor.execute(
        """
        UPDATE biz_sample
        SET sample_status = CASE WHEN sample_status = %s THEN %s ELSE sample_status END,
            flow_status = CASE WHEN flow_status = %s THEN %s ELSE flow_status END
        WHERE sample_status = %s
           OR flow_status = %s
        """,
        (
            LEGACY_TASK_STORED_STATUS,
            TASK_STORED_STATUS,
            LEGACY_TASK_STORED_STATUS,
            TASK_STORED_STATUS,
            LEGACY_TASK_STORED_STATUS,
            LEGACY_TASK_STORED_STATUS,
        ),
    )
    cursor.execute(
        """
        UPDATE biz_tray
        SET tray_status = CASE WHEN tray_status = %s THEN %s ELSE tray_status END,
            test_state = CASE WHEN test_state = %s THEN %s ELSE test_state END
        WHERE tray_status = %s
           OR test_state = %s
        """,
        (
            LEGACY_TASK_STORED_STATUS,
            TASK_STORED_STATUS,
            LEGACY_TASK_STORED_STATUS,
            TASK_STORED_STATUS,
            LEGACY_TASK_STORED_STATUS,
            LEGACY_TASK_STORED_STATUS,
        ),
    )
    cursor.execute(
        """
        UPDATE biz_tray_item
        SET status = %s
        WHERE status = %s
        """,
        (TASK_STORED_STATUS, LEGACY_TASK_STORED_STATUS),
    )
    cursor.execute(
        """
        UPDATE biz_sample_event
        SET sample_status = CASE WHEN sample_status = %s THEN %s ELSE sample_status END,
            detail = REPLACE(COALESCE(detail, ''), %s, %s)
        WHERE sample_status = %s
           OR detail LIKE %s
        """,
        (
            LEGACY_TASK_STORED_STATUS,
            TASK_STORED_STATUS,
            LEGACY_TASK_STORED_STATUS,
            TASK_STORED_STATUS,
            LEGACY_TASK_STORED_STATUS,
            f"%{LEGACY_TASK_STORED_STATUS}%",
        ),
    )
    cursor.execute(
        """
        UPDATE biz_task
        SET task_status = CASE
          WHEN task_status = %s THEN %s
          WHEN task_status IN (%s, %s) THEN %s
          ELSE task_status
        END
        WHERE task_status IN (%s, %s, %s)
        """,
        (
            LEGACY_EXPERIMENT_RUNNING_STATUS,
            TASK_RUNNING_STATUS,
            "实验完成",
            "实验已经完成",
            TASK_COMPLETED_STATUS,
            LEGACY_EXPERIMENT_RUNNING_STATUS,
            "实验完成",
            "实验已经完成",
        ),
    )
    cursor.execute(
        """
        UPDATE biz_experiment
        SET experiment_status = CASE
          WHEN experiment_status = %s THEN %s
          WHEN experiment_status IN (%s, %s) THEN %s
          ELSE experiment_status
        END
        WHERE experiment_status IN (%s, %s, %s)
        """,
        (
            LEGACY_EXPERIMENT_RUNNING_STATUS,
            EXPERIMENT_RUNNING_STATUS,
            "实验完成",
            "实验已经完成",
            CANONICAL_COMPLETED_STATUS,
            LEGACY_EXPERIMENT_RUNNING_STATUS,
            "实验完成",
            "实验已经完成",
        ),
    )
    cursor.execute(
        """
        UPDATE biz_schedule
        SET schedule_status = CASE
          WHEN schedule_status = %s THEN %s
          WHEN schedule_status IN (%s, %s) THEN %s
          ELSE schedule_status
        END
        WHERE schedule_status IN (%s, %s, %s)
        """,
        (
            LEGACY_EXPERIMENT_RUNNING_STATUS,
            EXPERIMENT_RUNNING_STATUS,
            "实验完成",
            "实验已经完成",
            CANONICAL_COMPLETED_STATUS,
            LEGACY_EXPERIMENT_RUNNING_STATUS,
            "实验完成",
            "实验已经完成",
        ),
    )
    cursor.execute(
        """
        UPDATE biz_sample
        SET sample_status = CASE
              WHEN sample_status = %s THEN %s
              WHEN sample_status IN (%s, %s) THEN %s
              ELSE sample_status
            END,
            flow_status = CASE
              WHEN flow_status = %s THEN %s
              WHEN flow_status IN (%s, %s) THEN %s
              ELSE flow_status
            END
        WHERE sample_status IN (%s, %s, %s)
           OR flow_status IN (%s, %s, %s)
        """,
        (
            LEGACY_EXPERIMENT_RUNNING_STATUS,
            EXPERIMENT_RUNNING_STATUS,
            "实验完成",
            "实验已经完成",
            CANONICAL_COMPLETED_STATUS,
            LEGACY_EXPERIMENT_RUNNING_STATUS,
            EXPERIMENT_RUNNING_STATUS,
            "实验完成",
            "实验已经完成",
            CANONICAL_COMPLETED_STATUS,
            LEGACY_EXPERIMENT_RUNNING_STATUS,
            "实验完成",
            "实验已经完成",
            LEGACY_EXPERIMENT_RUNNING_STATUS,
            "实验完成",
            "实验已经完成",
        ),
    )
    cursor.execute(
        """
        UPDATE biz_tray_item
        SET status = CASE
          WHEN status = %s THEN %s
          WHEN status IN (%s, %s) THEN %s
          ELSE status
        END
        WHERE status IN (%s, %s, %s)
        """,
        (
            LEGACY_EXPERIMENT_RUNNING_STATUS,
            EXPERIMENT_RUNNING_STATUS,
            "实验完成",
            "实验已经完成",
            CANONICAL_COMPLETED_STATUS,
            LEGACY_EXPERIMENT_RUNNING_STATUS,
            "实验完成",
            "实验已经完成",
        ),
    )
    cursor.execute(
        """
        UPDATE biz_sample_event
        SET sample_status = CASE
              WHEN sample_status = %s THEN %s
              WHEN sample_status IN (%s, %s) THEN %s
              ELSE sample_status
            END,
            detail = REPLACE(
              REPLACE(
                REPLACE(COALESCE(detail, ''), %s, %s),
                %s, %s
              ),
              %s, %s
            )
        WHERE sample_status IN (%s, %s, %s)
           OR detail LIKE %s
           OR detail LIKE %s
           OR detail LIKE %s
        """,
        (
            LEGACY_EXPERIMENT_RUNNING_STATUS,
            EXPERIMENT_RUNNING_STATUS,
            "实验完成",
            "实验已经完成",
            CANONICAL_COMPLETED_STATUS,
            "实验已经完成",
            CANONICAL_COMPLETED_STATUS,
            "实验完成",
            CANONICAL_COMPLETED_STATUS,
            LEGACY_EXPERIMENT_RUNNING_STATUS,
            EXPERIMENT_RUNNING_STATUS,
            LEGACY_EXPERIMENT_RUNNING_STATUS,
            "实验完成",
            "实验已经完成",
            "%实验中%",
            "%实验完成%",
            "%实验已经完成%",
        ),
    )


def sync_progress_statuses(backend: Any, cursor) -> None:
    backend._normalize_legacy_status_columns(cursor)
    cursor.execute(
        """
        SELECT task_id, task_no, task_status
        FROM biz_task
        WHERE source_system = %s
        ORDER BY task_no ASC
        """,
        (STORAGE_MARKER,),
    )
    tasks = cursor.fetchall()
    if not tasks:
        return

    cursor.execute(
        """
        SELECT experiment_id, experiment_no, task_id, task_no, experiment_name, experiment_status
        FROM biz_experiment
        ORDER BY task_no ASC, experiment_no ASC
        """
    )
    experiments = cursor.fetchall()

    cursor.execute(
        """
        SELECT schedule_id, task_id, task_no, experiment_no, schedule_status
        FROM biz_schedule
        WHERE schedule_type = %s
        ORDER BY task_no ASC, experiment_no ASC
        """,
        (STORAGE_MARKER,),
    )
    schedules = cursor.fetchall()

    cursor.execute(
        """
        SELECT relation_id, experiment_no, task_no, tray_no
        FROM biz_experiment_tray
        ORDER BY task_no ASC, experiment_no ASC, tray_no ASC
        """
    )
    experiment_trays = cursor.fetchall()

    cursor.execute(
        """
        SELECT relation_id, run_no, task_no, experiment_no, tray_no, run_tray_status
        FROM biz_experiment_run_tray
        ORDER BY task_no ASC, experiment_no ASC, tray_no ASC
        """
    )
    experiment_run_trays = cursor.fetchall()

    experiment_status_map = derive_experiment_status_map(
        experiments,
        schedules,
        experiment_trays=experiment_trays,
        experiment_run_trays=experiment_run_trays,
    )
    if experiment_status_map:
        cursor.executemany(
            "UPDATE biz_experiment SET experiment_status = %s WHERE experiment_no = %s",
            [(status, experiment_no) for experiment_no, status in experiment_status_map.items()],
        )
        if schedules:
            cursor.executemany(
                "UPDATE biz_schedule SET schedule_status = %s WHERE schedule_id = %s",
                [
                    (
                        experiment_status_map.get(normalize_text(row.get("experiment_no")), normalize_text(row.get("schedule_status"))),
                        row["schedule_id"],
                    )
                    for row in schedules
                ],
            )

    task_status_map = derive_task_status_map(tasks, experiments, experiment_status_map)
    if task_status_map:
        cursor.executemany(
            "UPDATE biz_task SET task_status = %s WHERE task_no = %s",
            [(status, task_no) for task_no, status in task_status_map.items()],
        )


def update_experiment_unscheduled_since(cursor, repaired: dict[str, datetime]) -> None:
    if not repaired:
        return
    cursor.executemany(
        """
        UPDATE biz_experiment
        SET unscheduled_since = %(unscheduled_since)s,
            updated_at = CURRENT_TIMESTAMP
        WHERE experiment_no = %(experiment_no)s
          AND unscheduled_since IS NULL
        """,
        [
            {
                "experiment_no": experiment_no,
                "unscheduled_since": unscheduled_since,
            }
            for experiment_no, unscheduled_since in repaired.items()
            if experiment_no
        ],
    )


def backfill_unscheduled_since_for_reads(
    backend: Any,
    cursor,
    *,
    tasks: list[dict[str, Any]],
    schedules: list[dict[str, Any]],
    experiments: list[dict[str, Any]],
    experiment_trays: list[dict[str, Any]],
    experiment_samples: list[dict[str, Any]],
    samples: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], bool]:
    next_experiments, repaired = backfill_missing_unscheduled_since(
        tasks,
        schedules,
        experiments,
        experiment_trays,
        experiment_samples,
        samples,
    )
    if not repaired:
        return next_experiments, False
    backend._update_experiment_unscheduled_since(cursor, repaired)
    return next_experiments, True
