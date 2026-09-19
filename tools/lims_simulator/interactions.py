"""Simulator-owned HTTP inbox. No MES database access."""
from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any

COMPLETION_EVENT = "mes.experiment.completion.v1"


class InteractionStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    def _connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path, timeout=10)
        conn.execute("""CREATE TABLE IF NOT EXISTS interactions (
            id INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE,
            task_code TEXT NOT NULL, event_type TEXT NOT NULL,
            received_at TEXT NOT NULL, body TEXT NOT NULL)""")
        return conn

    def receive(self, event: dict[str, Any], received_at: str) -> bool:
        body = json.dumps(event, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        with closing(self._connect()) as conn, conn:
            cursor = conn.execute(
                "INSERT OR IGNORE INTO interactions(event_id, task_code, event_type, received_at, body) VALUES (?, ?, ?, ?, ?)",
                (event["event_id"], str(event["payload"].get("code") or event["payload"].get("task_code") or ""),
                 event["type"], received_at, body),
            )
            duplicate = cursor.rowcount == 0
            if duplicate and conn.execute("SELECT body FROM interactions WHERE event_id=?", (event["event_id"],)).fetchone()[0] != body:
                raise ValueError("event_id 已存在且内容不同，请使用新的事件编号")
            if not duplicate and event["type"] == COMPLETION_EVENT:
                payload = event["payload"]
                previous = conn.execute(
                    "SELECT task_code, body FROM interactions WHERE event_type=? "
                    "AND json_extract(body, '$.payload.completion_id')=? AND event_id<>?",
                    (COMPLETION_EVENT, payload["completion_id"], event["event_id"]),
                ).fetchall()
                task_code = payload.get("code") or payload.get("task_code")
                for previous_task, previous_body in previous:
                    previous_payload = json.loads(previous_body)["payload"]
                    if previous_task != task_code or previous_payload.get("experiment_code") != payload["experiment_code"]:
                        raise ValueError("completion_id 已关联其他任务或试验")
                    if previous_payload["revision"] == payload["revision"] and previous_payload != payload:
                        raise ValueError("完成记录的同一 revision 内容不同，请增加版本号")
        return duplicate

    def list(self, *, task_code: str = "", limit: int = 50, offset: int = 0) -> dict[str, Any]:
        """Project one latest revision per completion; retain raw events for dedupe.

        ``total`` counts visible business records; ``raw_total`` counts all unique
        received events (including superseded completion revisions).
        """
        where = " WHERE task_code = ?" if task_code else ""
        params = (task_code,) if task_code else ()
        latest = """WITH ranked AS (
            SELECT *, ROW_NUMBER() OVER (
                PARTITION BY event_type, CASE WHEN event_type = ?
                    THEN json_extract(body, '$.payload.completion_id') ELSE event_id END
                ORDER BY CASE WHEN event_type = ?
                    THEN json_extract(body, '$.payload.revision') ELSE 0 END DESC, id ASC
            ) AS version_rank FROM interactions
        ), visible AS (SELECT * FROM ranked WHERE version_rank = 1)
        """
        projection_params = (COMPLETION_EVENT, COMPLETION_EVENT, *params)
        with closing(self._connect()) as conn:
            raw_total = conn.execute("SELECT COUNT(*) FROM interactions" + where, params).fetchone()[0]
            total = conn.execute(latest + "SELECT COUNT(*) FROM visible" + where, projection_params).fetchone()[0]
            rows = conn.execute(latest + "SELECT received_at, body FROM visible" + where + " ORDER BY id DESC LIMIT ? OFFSET ?", (*projection_params, limit, offset)).fetchall()
        return {"total": total, "raw_total": raw_total,
                "items": [{"received_at": at, "event": json.loads(body)} for at, body in rows]}
