from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta
import json
import logging
from threading import Lock
from time import perf_counter
from typing import Any, Callable

from app.core.time_utils import format_business_datetime, now_business_datetime, parse_business_datetime
from app.db.session import get_connection


logger = logging.getLogger(__name__)
RETENTION_LOCK_NAME = "mes:data-retention:v1"
STAGING_EVENTS_STORAGE_KEY = "mes.staging_events"
RETURNED_TASK_STATUS = "厂家收回"


def _first_value(row: Any, default: Any = None) -> Any:
    if isinstance(row, dict):
        return next(iter(row.values()), default)
    if isinstance(row, (tuple, list)) and row:
        return row[0]
    return default


def _text(value: Any) -> str:
    return str(value or "").strip()


def _staging_event_time(event: dict[str, Any]) -> datetime | None:
    return parse_business_datetime(
        event.get("time")
        or event.get("event_time")
        or event.get("created_at")
        or event.get("updated_at")
    )


def _staging_state_key(event: dict[str, Any]) -> tuple[str, ...] | None:
    task_code = _text(
        event.get("task_code")
        or event.get("taskCode")
        or event.get("task_no")
        or event.get("taskNo")
    )
    tray_code = _text(
        event.get("tray_code")
        or event.get("trayCode")
        or event.get("tray_no")
        or event.get("trayNo")
    )
    if not task_code and not tray_code:
        return None
    return (
        task_code,
        tray_code,
        _text(event.get("room") or event.get("storage_room") or event.get("storageRoom")),
        _text(event.get("action") or event.get("status")),
        _text(
            event.get("target_experiment_code")
            or event.get("targetExperimentCode")
            or event.get("experiment_code")
            or event.get("experimentCode")
        ),
        _text(event.get("appearance_phase") or event.get("appearancePhase")),
    )


def prune_staging_events(
    events: Any,
    *,
    cutoff: datetime,
    batch_size: int,
    protected_task_codes: set[str] | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """Remove one oldest batch while preserving state markers still needed by active tasks.

    A tray can legitimately have independent state markers for staging/appearance
    rooms, actions, experiment targets, and appearance phases. Keeping the latest
    marker for each such key preserves active workflow reconstruction. When a
    protected task set is supplied, returned/deleted task markers can age out so
    the shared JSON snapshot does not grow forever with historical tasks.
    """

    normalized = [dict(event) for event in events if isinstance(event, dict)] if isinstance(events, list) else []
    if not normalized or batch_size <= 0:
        return normalized, 0

    latest_by_state: dict[tuple[str, ...], tuple[datetime, int]] = {}
    for index, event in enumerate(normalized):
        state_key = _staging_state_key(event)
        if state_key is None:
            continue
        ordering = (_staging_event_time(event) or datetime.min, index)
        if state_key not in latest_by_state or ordering > latest_by_state[state_key]:
            latest_by_state[state_key] = ordering
    protected_indexes = {
        ordering[1]
        for state_key, ordering in latest_by_state.items()
        if protected_task_codes is None or not state_key[0] or state_key[0] in protected_task_codes
    }

    candidates: list[tuple[datetime, int]] = []
    for index, event in enumerate(normalized):
        event_time = _staging_event_time(event)
        if event_time is None or event_time >= cutoff or index in protected_indexes:
            continue
        candidates.append((event_time, index))
    candidates.sort()
    deleted_indexes = {index for _event_time, index in candidates[:batch_size]}
    return [event for index, event in enumerate(normalized) if index not in deleted_indexes], len(deleted_indexes)


@dataclass(frozen=True)
class DataRetentionPolicy:
    mq_message_log_days: int
    experiment_event_days: int
    staging_event_days: int
    batch_size: int
    max_batches_per_run: int

    @classmethod
    def from_settings(cls, settings: Any) -> "DataRetentionPolicy":
        return cls(
            mq_message_log_days=max(0, int(settings.MQ_MESSAGE_LOG_RETENTION_DAYS)),
            experiment_event_days=max(0, int(settings.EXPERIMENT_EVENT_RETENTION_DAYS)),
            staging_event_days=max(0, int(settings.STAGING_EVENT_RETENTION_DAYS)),
            batch_size=max(1, int(settings.RETENTION_BATCH_SIZE)),
            max_batches_per_run=max(1, int(settings.RETENTION_MAX_BATCHES_PER_RUN)),
        )


class DataRetentionService:
    def __init__(
        self,
        policy: DataRetentionPolicy,
        *,
        connection_factory: Callable[[], Any] = get_connection,
        clock: Callable[[], datetime] = now_business_datetime,
    ) -> None:
        self.policy = policy
        self._connection_factory = connection_factory
        self._clock = clock
        self._run_lock = Lock()

    @staticmethod
    def _delete_mq_batch(cursor: Any, cutoff: datetime, batch_size: int) -> int:
        cursor.execute(
            """
            DELETE FROM biz_mq_message_log
            WHERE message_log_id IN (
              SELECT message_log_id
              FROM (
                SELECT old.message_log_id
                FROM biz_mq_message_log old
                WHERE old.created_at < %s
                  AND EXISTS (
                    SELECT 1
                    FROM biz_mq_message_log newer
                    WHERE newer.direction <=> old.direction
                      AND newer.lab_code <=> old.lab_code
                      AND newer.task_no <=> old.task_no
                      AND newer.experiment_no <=> old.experiment_no
                      AND newer.sub_experiment_code <=> old.sub_experiment_code
                      AND newer.message_type <=> old.message_type
                      AND (
                        newer.created_at > old.created_at
                        OR (newer.created_at = old.created_at AND newer.message_log_id > old.message_log_id)
                      )
                  )
                ORDER BY old.created_at ASC, old.message_log_id ASC
                LIMIT %s
              ) retention_candidates
            )
            """,
            (cutoff, batch_size),
        )
        return max(0, int(cursor.rowcount or 0))

    @staticmethod
    def _delete_experiment_event_batch(cursor: Any, cutoff: datetime, batch_size: int) -> int:
        cursor.execute(
            """
            DELETE FROM biz_experiment_event
            WHERE experiment_event_id IN (
              SELECT experiment_event_id
              FROM (
                SELECT old.experiment_event_id
                FROM biz_experiment_event old
                WHERE old.created_at < %s
                  AND EXISTS (
                    SELECT 1
                    FROM biz_experiment_event newer
                    WHERE newer.task_no <=> old.task_no
                      AND newer.experiment_no <=> old.experiment_no
                      AND newer.sub_experiment_code <=> old.sub_experiment_code
                      AND newer.lab_code <=> old.lab_code
                      AND newer.event_type <=> old.event_type
                      AND (
                        newer.created_at > old.created_at
                        OR (
                          newer.created_at = old.created_at
                          AND newer.experiment_event_id > old.experiment_event_id
                        )
                      )
                  )
                ORDER BY old.created_at ASC, old.experiment_event_id ASC
                LIMIT %s
              ) retention_candidates
            )
            """,
            (cutoff, batch_size),
        )
        return max(0, int(cursor.rowcount or 0))

    @staticmethod
    def _delete_staging_batch(cursor: Any, cutoff: datetime, batch_size: int) -> int:
        cursor.execute(
            """
            SELECT task_no
            FROM biz_task
            WHERE COALESCE(task_status, '') <> %s
              AND COALESCE(transfer_status, '') <> %s
            """,
            (RETURNED_TASK_STATUS, RETURNED_TASK_STATUS),
        )
        active_task_codes = {
            _text(_first_value(row))
            for row in (cursor.fetchall() or [])
            if _text(_first_value(row))
        }
        cursor.execute(
            """
            SELECT payload_json
            FROM app_storage_snapshot
            WHERE storage_key = %s
            FOR UPDATE
            """,
            (STAGING_EVENTS_STORAGE_KEY,),
        )
        row = cursor.fetchone()
        raw_payload = _first_value(row)
        if not raw_payload:
            return 0
        try:
            events = json.loads(raw_payload) if isinstance(raw_payload, str) else raw_payload
        except (TypeError, json.JSONDecodeError):
            logger.warning("data_retention_invalid_staging_payload")
            return 0
        retained, deleted = prune_staging_events(
            events,
            cutoff=cutoff,
            batch_size=batch_size,
            protected_task_codes=active_task_codes,
        )
        if deleted:
            cursor.execute(
                """
                UPDATE app_storage_snapshot
                SET payload_json = %s, updated_at = CURRENT_TIMESTAMP
                WHERE storage_key = %s
                """,
                (json.dumps(retained, ensure_ascii=False, separators=(",", ":")), STAGING_EVENTS_STORAGE_KEY),
            )
        return deleted

    @staticmethod
    def _release_database_lock(connection: Any) -> None:
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT RELEASE_LOCK(%s)", (RETENTION_LOCK_NAME,))
        except Exception:
            logger.exception("data_retention_lock_release_failed")

    def _run_table_batches(
        self,
        connection: Any,
        *,
        cleanup: Callable[[Any, datetime, int], int],
        cutoff: datetime,
    ) -> tuple[int, int]:
        deleted_total = 0
        batches = 0
        for _index in range(self.policy.max_batches_per_run):
            try:
                with connection.cursor() as cursor:
                    deleted = cleanup(cursor, cutoff, self.policy.batch_size)
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            if deleted <= 0:
                break
            deleted_total += deleted
            batches += 1
            if deleted < self.policy.batch_size:
                break
        return deleted_total, batches

    def run_once(self) -> dict[str, Any]:
        if not self._run_lock.acquire(blocking=False):
            return {"acquired": False, "skippedReason": "local-run-active", "deleted": {}}
        started = perf_counter()
        now = self._clock()
        try:
            with self._connection_factory() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT GET_LOCK(%s, 0)", (RETENTION_LOCK_NAME,))
                    acquired = int(_first_value(cursor.fetchone(), 0) or 0) == 1
                if not acquired:
                    return {
                        "acquired": False,
                        "skippedReason": "database-lock-active",
                        "deleted": {},
                        "durationMs": round((perf_counter() - started) * 1000, 3),
                    }
                try:
                    deleted: dict[str, int] = {}
                    batches: dict[str, int] = {}
                    cleanup_specs = (
                        (
                            "biz_mq_message_log",
                            self.policy.mq_message_log_days,
                            self._delete_mq_batch,
                        ),
                        (
                            "biz_experiment_event",
                            self.policy.experiment_event_days,
                            self._delete_experiment_event_batch,
                        ),
                        (
                            STAGING_EVENTS_STORAGE_KEY,
                            self.policy.staging_event_days,
                            self._delete_staging_batch,
                        ),
                    )
                    cutoffs: dict[str, str] = {}
                    for name, retention_days, cleanup in cleanup_specs:
                        if retention_days <= 0:
                            deleted[name] = 0
                            batches[name] = 0
                            continue
                        cutoff = now - timedelta(days=retention_days)
                        cutoffs[name] = format_business_datetime(cutoff)
                        deleted[name], batches[name] = self._run_table_batches(
                            connection,
                            cleanup=cleanup,
                            cutoff=cutoff,
                        )
                    return {
                        "acquired": True,
                        "deleted": deleted,
                        "batches": batches,
                        "cutoffs": cutoffs,
                        "durationMs": round((perf_counter() - started) * 1000, 3),
                    }
                finally:
                    self._release_database_lock(connection)
        finally:
            self._run_lock.release()


class DataRetentionRuntime:
    def __init__(self, settings: Any, *, service: DataRetentionService | None = None) -> None:
        self.settings = settings
        self.enabled = bool(settings.RETENTION_ENABLED and settings.STORAGE_BACKEND == "mysql")
        self.service = service or DataRetentionService(DataRetentionPolicy.from_settings(settings))
        self._task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()
        self._running = False
        self._last_started_at = ""
        self._last_finished_at = ""
        self._last_error = ""
        self._last_result: dict[str, Any] = {}
        self._total_deleted: dict[str, int] = {}

    def status(self) -> dict[str, Any]:
        policy = getattr(self.service, "policy", None)
        policy_status = (
            {
                "mqMessageLogDays": policy.mq_message_log_days,
                "experimentEventDays": policy.experiment_event_days,
                "stagingEventDays": policy.staging_event_days,
                "batchSize": policy.batch_size,
                "maxBatchesPerRun": policy.max_batches_per_run,
            }
            if isinstance(policy, DataRetentionPolicy)
            else {}
        )
        return {
            "enabled": self.enabled,
            "scheduled": self._task is not None and not self._task.done(),
            "running": self._running,
            "policy": policy_status,
            "lastStartedAt": self._last_started_at,
            "lastFinishedAt": self._last_finished_at,
            "lastError": self._last_error,
            "lastResult": dict(self._last_result),
            "totalDeleted": dict(self._total_deleted),
        }

    async def run_now(self) -> dict[str, Any]:
        self._running = True
        self._last_started_at = format_business_datetime(now_business_datetime())
        try:
            result = await asyncio.to_thread(self.service.run_once)
            self._last_result = dict(result)
            self._last_error = ""
            for key, count in result.get("deleted", {}).items():
                self._total_deleted[key] = self._total_deleted.get(key, 0) + int(count or 0)
            deleted_total = sum(int(count or 0) for count in result.get("deleted", {}).values())
            log = logger.info if deleted_total else logger.debug
            log("data_retention_run_complete result=%s", result)
            return result
        except Exception as exc:
            self._last_error = str(exc)
            logger.exception("data_retention_run_failed")
            raise
        finally:
            self._running = False
            self._last_finished_at = format_business_datetime(now_business_datetime())

    async def _wait_or_stop(self, seconds: float) -> bool:
        try:
            await asyncio.wait_for(self._stop_event.wait(), timeout=max(0.01, seconds))
            return True
        except TimeoutError:
            return False

    async def _run_loop(self) -> None:
        if await self._wait_or_stop(float(self.settings.RETENTION_STARTUP_DELAY_SECONDS)):
            return
        while not self._stop_event.is_set():
            try:
                await self.run_now()
            except Exception:
                # The status and log retain the error; the next interval retries.
                pass
            if await self._wait_or_stop(float(self.settings.RETENTION_INTERVAL_SECONDS)):
                return

    def start(self) -> None:
        if not self.enabled or (self._task is not None and not self._task.done()):
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run_loop(), name="mes-data-retention")

    async def stop(self) -> None:
        task = self._task
        if task is None:
            return
        self._stop_event.set()
        await task
        self._task = None


__all__ = [
    "DataRetentionPolicy",
    "DataRetentionRuntime",
    "DataRetentionService",
    "RETENTION_LOCK_NAME",
    "STAGING_EVENTS_STORAGE_KEY",
    "prune_staging_events",
]
