from __future__ import annotations

from pathlib import Path
from typing import Any

from app.services import test_data_reports
from app.services.test_data_repository import get_test_data_repository


def _text(value: Any) -> str:
    return str(value or "").strip()


def _relative_path(value: Any) -> Path | None:
    text = _text(value)
    if not text:
        return None
    path = Path(text)
    if path.is_absolute() or any(part == ".." for part in path.parts):
        return None
    return path


def _managed_file(record: dict[str, Any], current_root: Path) -> tuple[Path, Path] | None:
    """Return the recorded PDF and its generation root without trusting traversal paths."""
    relative = _relative_path(record.get("relativePath"))
    recorded_text = _text(record.get("filePath"))
    recorded = Path(recorded_text).expanduser().resolve(strict=False) if recorded_text else None

    if relative is not None and recorded is not None:
        relative_parts = relative.parts
        if len(recorded.parts) >= len(relative_parts) and recorded.parts[-len(relative_parts) :] == relative_parts:
            root = Path(*recorded.parts[: -len(relative_parts)]).resolve(strict=False)
            candidate = (root / relative).resolve(strict=False)
            if candidate == recorded:
                return candidate, root

    if relative is not None:
        root = current_root.resolve(strict=False)
        candidate = (root / relative).resolve(strict=False)
        try:
            candidate.relative_to(root)
        except ValueError:
            return None
        return candidate, root

    return None


def _remove_empty_parents(start: Path, root: Path) -> None:
    current = start.resolve(strict=False)
    root = root.resolve(strict=False)
    while current != root:
        try:
            current.relative_to(root)
        except ValueError:
            return
        try:
            current.rmdir()
        except (FileNotFoundError, OSError):
            return
        current = current.parent


def prepare_test_data_cleanup(*, storage: Any) -> dict[str, Any]:
    """Capture cleanup inputs before the task reset replaces snapshot collections."""
    settings_records = storage.read(test_data_reports.SETTINGS_STORAGE_KEY)
    settings_records = (
        [dict(item) for item in settings_records if isinstance(item, dict)]
        if isinstance(settings_records, list)
        else []
    )
    settings = test_data_reports.read_test_data_settings(storage=storage)
    return {
        "currentRoot": settings["savePath"],
        "settingsRecords": settings_records,
        "exportRecords": test_data_reports.list_export_records(storage=storage),
    }


def clear_all_test_data_files(*, storage: Any, prepared: dict[str, Any] | None = None) -> dict[str, int]:
    """Delete generated PDFs and export/share metadata while preserving save settings.

    File deletion is deliberately limited to paths reconstructed from export metadata.
    This keeps unrelated files safe when an operator selects a non-empty directory.
    """
    cleanup = dict(prepared) if isinstance(prepared, dict) else prepare_test_data_cleanup(storage=storage)
    current_root = Path(_text(cleanup.get("currentRoot"))).resolve(strict=False)
    records = [dict(item) for item in cleanup.get("exportRecords", []) if isinstance(item, dict)]
    settings_records = [dict(item) for item in cleanup.get("settingsRecords", []) if isinstance(item, dict)]
    deleted_files = 0
    missing_files = 0

    persistence_lock = getattr(test_data_reports, "_PERSISTENCE_LOCK", None)

    def clear() -> None:
        nonlocal deleted_files, missing_files
        for record in records:
            managed = _managed_file(record, current_root)
            if managed is None:
                continue
            target, generation_root = managed
            if target.is_symlink() or target.is_file():
                target.unlink()
                deleted_files += 1
                _remove_empty_parents(target.parent, generation_root)
            elif target.exists():
                raise OSError(f"试验数据导出路径不是文件：{target}")
            else:
                missing_files += 1

        get_test_data_repository(storage).clear_metadata()
        storage.write(test_data_reports.SETTINGS_STORAGE_KEY, settings_records)

    if persistence_lock is None:
        clear()
    else:
        with persistence_lock:
            clear()

    current_root.mkdir(parents=True, exist_ok=True)
    return {
        "deleted_file_count": deleted_files,
        "missing_file_count": missing_files,
        "cleared_export_count": len(records),
    }
