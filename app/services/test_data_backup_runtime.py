"""Isolate potentially blocking SMB IO from FastAPI and MQTT lifecycle threads."""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
import subprocess
import sys
import time

from app.core.config import REPO_ROOT
from app.services.test_data_backup import backup_status

logger = logging.getLogger(__name__)


class TestDataBackupRuntime:
    __test__ = False

    def __init__(self, settings):
        self.settings = settings
        self.task = None
        self.process = None
        self.last_error = ""
        self.last_finished_at = None

    @property
    def enabled(self):
        return bool(self.settings.TEST_DATA_BACKUP_PATH.strip())

    def start(self):
        if self.enabled and (self.task is None or self.task.done()):
            self.task = asyncio.create_task(self._run())

    async def stop(self):
        if self.task is not None:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
            self.task = None

    async def _pass(self):
        # Settings passed via environment, not command line (contains DB credentials).
        environment = dict(os.environ)
        environment.update({key: str(value) for key, value in self.settings.model_dump().items() if value is not None})
        process = subprocess.Popen(
            [sys.executable, "-m", "app.services.test_data_backup"], cwd=REPO_ROOT,
            env=environment, stdout=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        self.process = process
        started = time.monotonic()
        try:
            while process.poll() is None:
                if time.monotonic() - started >= self.settings.TEST_DATA_BACKUP_TIMEOUT_SECONDS:
                    raise TimeoutError("试验数据备份超时，下次自动补传")
                await asyncio.sleep(0.25)
            if process.returncode:
                raise RuntimeError(f"试验数据备份进程退出：{process.returncode}，请检查后端日志")
        finally:
            if process.poll() is None:
                process.kill()
            # Do not block the event loop on network/process termination.
            while process.poll() is None:
                await asyncio.sleep(0.05)
            self.process = None

    async def _run(self):
        while True:
            try:
                await self._pass()
                self.last_error = ""
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.last_error = str(exc)
                logger.warning("Report backup worker: %s", exc)
            self.last_finished_at = time.time()
            await asyncio.sleep(self.settings.TEST_DATA_BACKUP_INTERVAL_SECONDS)

    def status(self):
        result = {"enabled": self.enabled, "destination": self.settings.TEST_DATA_BACKUP_PATH,
                  "running": self.process is not None, "lastError": self.last_error,
                  "lastFinishedAt": self.last_finished_at,
                  "intervalSeconds": self.settings.TEST_DATA_BACKUP_INTERVAL_SECONDS}
        try:
            result.update(backup_status(Path(self.settings.TEST_DATA_BACKUP_STATE_PATH), self.settings.TEST_DATA_BACKUP_PATH))
        except Exception as exc:
            result["lastError"] = f"无法读取本地备份记录：{exc}"
        return result
