"""Host-local backup destination override; independent from report savePath."""
import json
import os
from pathlib import Path
import tempfile


def settings_file(settings) -> Path:
    return Path(settings.TEST_DATA_BACKUP_STATE_PATH).with_suffix(".settings.json")


def read_backup_path(settings) -> str:
    path = settings_file(settings)
    if not path.exists():
        return settings.TEST_DATA_BACKUP_PATH
    payload = json.loads(path.read_text(encoding="utf-8"))
    value = payload["backupPath"]
    if not isinstance(value, str) or (value and not Path(value).is_absolute()):
        raise ValueError("本机备份设置损坏，请重新保存备份路径")
    return value


def save_backup_path(settings, destination: str) -> None:
    if not Path(destination).is_absolute():
        raise ValueError("备份目录必须是绝对路径")
    path = settings_file(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=".backup-settings-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump({"backupPath": destination}, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)
