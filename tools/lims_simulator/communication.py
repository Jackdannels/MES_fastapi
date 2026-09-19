"""Simulator-owned durable dispatch journal and controlled failure injection."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import time
import uuid
from contextlib import closing
from datetime import datetime, timezone


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


class CommunicationStore:
    def __init__(self, path):
        self.path = path

    def _connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path, timeout=10)
        conn.execute("""CREATE TABLE IF NOT EXISTS dispatch (
            seq INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL UNIQUE,
            request_id TEXT NOT NULL UNIQUE, task_code TEXT NOT NULL UNIQUE,
            body TEXT NOT NULL, digest TEXT NOT NULL, status TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0, next_attempt REAL NOT NULL DEFAULT 0,
            last_error TEXT NOT NULL DEFAULT '')""")
        conn.execute("CREATE TABLE IF NOT EXISTS communication_settings (key TEXT PRIMARY KEY, body TEXT NOT NULL)")
        return conn

    def enqueue(self, payload):
        with closing(self._connect()) as conn, conn:
            conn.execute("BEGIN IMMEDIATE")
            existing = conn.execute("SELECT body FROM dispatch WHERE request_id=? OR task_code=?",
                                    (payload["lims_request_id"], payload["code"])).fetchone()
            if existing:
                envelope = json.loads(existing[0])
                if envelope["payload"] != payload:
                    raise ValueError("请求号或任务编号已存在且内容不同，不可覆盖已下发消息")
                return envelope
            envelope = {"message_id": uuid.uuid4().hex, "correlation_id": payload["lims_request_id"],
                        "type": "lims.external-intake.created.v1", "schema_version": 1, "source": "LIMS",
                        "occurred_at": datetime.now(timezone.utc).isoformat(), "payload": payload}
            conn.execute("INSERT INTO dispatch(message_id,request_id,task_code,body,digest,status) VALUES (?,?,?,?,?,?)",
                         (envelope["message_id"], payload["lims_request_id"], payload["code"],
                          json.dumps(envelope, ensure_ascii=False), digest(envelope), "queued"))
            return envelope

    def claim(self, identity, retry_seconds=10):
        with closing(self._connect()) as conn, conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT body,status,next_attempt FROM dispatch WHERE message_id=?", (identity,)).fetchone()
            if not row or row[1] in {"received", "accepted", "failed"} or row[2] > time.time():
                return None
            conn.execute("UPDATE dispatch SET attempts=attempts+1,next_attempt=? WHERE message_id=?", (time.time() + retry_seconds, identity))
            return json.loads(row[0])

    def attempted(self, identity, error=""):
        with closing(self._connect()) as conn, conn:
            conn.execute("UPDATE dispatch SET status=?,last_error=? WHERE message_id=? AND status NOT IN ('received','accepted','failed')",
                         ("queued" if error else "published", error, identity))

    def manifest(self, after=0, limit=100):
        with closing(self._connect()) as conn:
            rows = conn.execute("SELECT seq,message_id,digest FROM dispatch WHERE seq>? ORDER BY seq LIMIT ?", (after, limit + 1)).fetchall()
        return {"dispatch": [{"sequence": seq, "id": identity, "digest": value} for seq, identity, value in rows[:limit]],
                "dispatch_more": len(rows) > limit}

    def confirm(self, items):
        with closing(self._connect()) as conn, conn:
            for item in items:
                row = conn.execute("SELECT digest FROM dispatch WHERE message_id=?", (item["id"],)).fetchone()
                if not row or row[0] != item["digest"]:
                    raise ValueError("Dispatch confirmation digest mismatch")
                conn.execute("UPDATE dispatch SET status=?,last_error='' WHERE message_id=? AND status<>'accepted'",
                             (item["outcome"], item["id"]))

    def replay(self, identity):
        with closing(self._connect()) as conn, conn:
            conn.execute("UPDATE dispatch SET status='queued' WHERE message_id=?", (identity,))

    def business_status(self, request_id, status):
        with closing(self._connect()) as conn, conn:
            conn.execute("UPDATE dispatch SET status=? WHERE request_id=? AND status<>'accepted' AND NOT (status='failed' AND ? IN ('received','pending'))",
                         (status, request_id, status))

    def summary(self):
        with closing(self._connect()) as conn:
            total, pending = conn.execute("SELECT COUNT(*),COALESCE(SUM(status IN ('queued','published','pending')),0) FROM dispatch").fetchone()
            rows = conn.execute("SELECT task_code,message_id,status,attempts,last_error FROM dispatch ORDER BY seq DESC LIMIT 100").fetchall()
        return {"total": total, "pending": pending,
                "items": [dict(zip(("task_code", "message_id", "status", "attempts", "last_error"), row)) for row in rows]}

    def faults(self):
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT body FROM communication_settings WHERE key='faults'").fetchone()
        return json.loads(row[0]) if row else {}

    def set_faults(self, faults):
        with closing(self._connect()) as conn, conn:
            conn.execute("INSERT INTO communication_settings(key,body) VALUES ('faults',?) ON CONFLICT(key) DO UPDATE SET body=excluded.body",
                         (json.dumps(faults),))

    def take_fault(self, name):
        with closing(self._connect()) as conn, conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT body FROM communication_settings WHERE key='faults'").fetchone()
            faults = json.loads(row[0]) if row else {}
            active = bool(faults.pop(name, False))
            if active:
                conn.execute("UPDATE communication_settings SET body=? WHERE key='faults'", (json.dumps(faults),))
            return active
