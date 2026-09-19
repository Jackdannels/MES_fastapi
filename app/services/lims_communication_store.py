"""Private MySQL snapshot records for LIMS transport (not editable UI storage).

No schema change: these records live in the existing app_storage_snapshot table.
The scheduler holds a database advisory lock; short journal updates use row locks.
"""
from __future__ import annotations

import hashlib
import json
from contextlib import closing

from app.db.session import get_connection

STATE_KEY = "lims.communication.state"
CONTROL_KEY = "lims.communication.control"
SENT_KEY = "lims.communication.sent"
RECEIVED_KEY = "lims.communication.received"
LOCK_NAME = "mes.lims.communication.cycle"


def digest(value: dict) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def wire_event(event: dict) -> dict:
    result = {key: value for key, value in event.items() if key not in {"routing_key", "_delivery"}}
    for key, default in (("source", "MES"), ("correlation_id", ""), ("message_id", "")):
        result.setdefault(key, default)
    return result


class CommunicationRepository:
    def __init__(self, connection_factory=None):
        self.connection_factory = connection_factory or get_connection

    def read(self, key, default=None):
        with closing(self.connection_factory()) as conn, conn.cursor() as cursor:
            cursor.execute("SELECT payload_json FROM app_storage_snapshot WHERE storage_key=%s", (key,))
            row = cursor.fetchone()
            return json.loads(row[0]) if row else default

    def update(self, key, change, default=None):
        with closing(self.connection_factory()) as conn:
            try:
                with conn.cursor() as cursor:
                    cursor.execute("INSERT IGNORE INTO app_storage_snapshot(storage_key,payload_json) VALUES (%s,%s)",
                                   (key, json.dumps(default)))
                    cursor.execute("SELECT payload_json FROM app_storage_snapshot WHERE storage_key=%s FOR UPDATE", (key,))
                    value = change(json.loads(cursor.fetchone()[0]))
                    cursor.execute("UPDATE app_storage_snapshot SET payload_json=%s, updated_at=CURRENT_TIMESTAMP WHERE storage_key=%s",
                                   (json.dumps(value, ensure_ascii=False, separators=(",", ":")), key))
                conn.commit()
                return value
            except BaseException:
                conn.rollback()
                raise

    def save_state(self, state):
        return self.update(STATE_KEY, lambda _: state, {})

    def command(self, action):
        return self.update(CONTROL_KEY, lambda current: {**(current or {}), action: True}, {})

    def take_commands(self):
        result = {}
        def take(current):
            result.update(current or {})
            return {}
        self.update(CONTROL_KEY, take, {})
        return result

    def record(self, key, identity, body, **fields):
        body_digest = digest(body)
        def append(rows):
            rows = rows or []
            existing = next((row for row in rows if row["id"] == identity), None)
            if existing:
                if existing["digest"] != body_digest:
                    raise ValueError("Message identity/content conflict")
                return rows
            return [*rows, {"id": identity, "digest": body_digest, "body": body, **fields}]
        self.update(key, append, [])

    def acquire_cycle(self):
        conn = self.connection_factory()
        try:
            with conn.cursor() as cursor:
                cursor.execute("SELECT GET_LOCK(%s, 0)", (LOCK_NAME,))
                acquired = cursor.fetchone()[0] == 1
            if acquired:
                return conn
        except BaseException:
            conn.close()
            raise
        conn.close()
        return None

    @staticmethod
    def release_cycle(conn):
        try:
            with conn.cursor() as cursor:
                cursor.execute("SELECT RELEASE_LOCK(%s)", (LOCK_NAME,))
        except BaseException:
            # Never return a possibly lock-owning physical connection to the pool.
            try:
                conn.close(discard=True)
            except TypeError:
                conn.close()
            raise
        else:
            conn.close()
