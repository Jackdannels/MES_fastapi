"""Simulator-owned monthly sequence; never reads or writes the MES database."""
import re
import sqlite3
from pathlib import Path

EXTERNAL_TASK_CODE_PATTERN = re.compile(r"SYLUW-(\d{4}-(?:0[1-9]|1[0-2]))-(\d{3,})")
# MES reset fixtures use 001-018; keep the first 20 for those fixtures.
DEMO_RESERVED_SEQUENCE = 20


class TaskNumberSequence:
    def __init__(self, path: Path):
        self.path = path

    def _update(self, month: str, minimum: int | None = None) -> int:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.path, timeout=10) as connection:
            connection.execute("CREATE TABLE IF NOT EXISTS task_sequence (month TEXT PRIMARY KEY, value INTEGER NOT NULL)")
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT value FROM task_sequence WHERE month = ?", (month,)).fetchone()
            current = max(int(row[0]) if row else 0, DEMO_RESERVED_SEQUENCE)
            value = current + 1 if minimum is None else max(current, minimum)
            connection.execute(
                "INSERT INTO task_sequence(month, value) VALUES (?, ?) "
                "ON CONFLICT(month) DO UPDATE SET value = excluded.value",
                (month, value),
            )
        return value

    def next_code(self, month: str) -> str:
        return f"SYLUW-{month}-{self._update(month):03d}"

    def observe(self, code: str) -> None:
        match = EXTERNAL_TASK_CODE_PATTERN.fullmatch(code)
        if not match or int(match.group(2)) == 0:
            raise ValueError("外部委托任务编号必须为 SYLUW-YYYY-MM-流水号（至少三位，且大于零）")
        # Manual numbers also move the high-water mark, avoiding future reuse.
        self._update(match.group(1), int(match.group(2)))
