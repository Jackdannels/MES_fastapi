from __future__ import annotations

import html
import ipaddress
import os
import tempfile
import zipfile
from pathlib import Path
from threading import Lock
from typing import Any
from urllib.parse import quote

from app.core.axis_codes import canonical_axis_code
from app.services.test_data_reports import (
    _ensure_within_root,
    read_test_data_settings,
    safe_path_segment,
)
from app.services.test_data_repository import get_test_data_repository


COMPLETED_EXPERIMENT_STATUSES = {"实验已完成", "实验完成", "实验已经完成"}
_DIRECTORY_PICKER_LOCK = Lock()


def _text(value: Any) -> str:
    return str(value or "").strip()


def _rows(value: Any) -> list[dict[str, Any]]:
    return [dict(item) for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def is_loopback_client(host: str | None) -> bool:
    normalized = _text(host).strip("[]").lower()
    if normalized in {"localhost", "testclient"}:
        return True
    try:
        return ipaddress.ip_address(normalized).is_loopback
    except ValueError:
        return False


def select_test_data_directory(initial_path: str = "") -> dict[str, Any]:
    if os.name != "nt":
        raise RuntimeError("目录浏览仅支持运行 MES 后端的 Windows 主机")
    if not _DIRECTORY_PICKER_LOCK.acquire(blocking=False):
        raise RuntimeError("已有目录选择窗口，请先完成当前选择")
    root = None
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askdirectory(
            parent=root,
            title="选择 MES 试验数据保存目录",
            initialdir=initial_path or str(Path.home() / "Desktop"),
            mustexist=True,
        )
        return {"savePath": str(Path(selected).resolve(strict=False)) if selected else "", "cancelled": not bool(selected)}
    finally:
        if root is not None:
            root.destroy()
        _DIRECTORY_PICKER_LOCK.release()


def _storage_many(storage: Any, keys: list[str]) -> dict[str, Any]:
    reader = getattr(storage, "read_many", None)
    if callable(reader):
        return dict(reader(keys))
    return {key: storage.read(key) for key in keys}


def _task_code(row: dict[str, Any]) -> str:
    return _text(row.get("code") or row.get("task_code") or row.get("task_no") or row.get("id"))


def _experiment_code(row: dict[str, Any]) -> str:
    return _text(row.get("experiment_code") or row.get("experiment_no") or row.get("id"))


def _experiment_folder(root: Path, task_code: str, experiment: dict[str, Any], exports: list[dict[str, Any]]) -> Path:
    scoped = [
        item
        for item in exports
        if _text(item.get("taskCode")) == task_code
        and _text(item.get("experimentCode")) == _experiment_code(experiment)
        and _text(item.get("relativePath"))
    ]
    if scoped:
        relative = Path(_text(scoped[0].get("relativePath")))
        if len(relative.parts) >= 2:
            return _ensure_within_root(root, root / relative.parts[0] / relative.parts[1])
    experiment_name = _text(experiment.get("experiment_name") or experiment.get("name")) or _experiment_code(experiment)
    return _ensure_within_root(root, root / safe_path_segment(task_code) / safe_path_segment(experiment_name))


def _task_folder(root: Path, task_code: str, exports: list[dict[str, Any]]) -> Path:
    scoped = [
        item
        for item in exports
        if _text(item.get("taskCode")) == task_code and _text(item.get("relativePath"))
    ]
    if scoped:
        relative = Path(_text(scoped[0].get("relativePath")))
        if relative.parts:
            return _ensure_within_root(root, root / relative.parts[0])
    return _ensure_within_root(root, root / safe_path_segment(task_code))


def list_task_data(
    *,
    storage: Any,
    query: str = "",
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    data = _storage_many(storage, ["mes.tasks", "mes.experiments", "mes.experiment_samples"])
    tasks = _rows(data.get("mes.tasks"))
    experiments = _rows(data.get("mes.experiments"))
    experiment_samples = _rows(data.get("mes.experiment_samples"))
    exports = get_test_data_repository(storage).list_exports()
    root = Path(read_test_data_settings(storage=storage)["savePath"]).resolve(strict=False)
    normalized_query = _text(query).lower()
    items: list[dict[str, Any]] = []

    known_task_codes = {_task_code(task) for task in tasks if _task_code(task)}
    known_task_codes.update(_text(row.get("task_code") or row.get("task_no")) for row in experiments)
    task_by_code = {_task_code(task): task for task in tasks if _task_code(task)}
    for task_code in sorted((code for code in known_task_codes if code), reverse=True):
        task = task_by_code.get(task_code, {})
        task_name = _text(task.get("name") or task.get("task_name") or task.get("project_name"))
        if normalized_query and normalized_query not in f"{task_code} {task_name}".lower():
            continue
        scoped_experiments = [
            experiment
            for experiment in experiments
            if _text(experiment.get("task_code") or experiment.get("task_no")) == task_code
        ]
        experiment_items: list[dict[str, Any]] = []
        for experiment in scoped_experiments:
            experiment_code = _experiment_code(experiment)
            status = _text(experiment.get("status") or experiment.get("experiment_status"))
            completed = status in COMPLETED_EXPERIMENT_STATUSES
            scoped_exports = [
                item
                for item in exports
                if _text(item.get("taskCode")) == task_code
                and _text(item.get("experimentCode")) == experiment_code
            ]
            success_count = sum(1 for item in scoped_exports if _text(item.get("status")) == "success")
            failed_count = sum(1 for item in scoped_exports if _text(item.get("status")) == "failed")
            sample_count = len(
                {
                    _text(row.get("sample_code") or row.get("sample_no"))
                    for row in experiment_samples
                    if _text(row.get("task_code") or row.get("task_no")) == task_code
                    and _text(row.get("experiment_code") or row.get("experiment_no")) == experiment_code
                    and _text(row.get("sample_code") or row.get("sample_no"))
                }
            )
            configured_axes = experiment.get("axis_codes") or experiment.get("axisCodes")
            axis_codes = {
                canonical_axis_code(axis)
                for axis in (configured_axes if isinstance(configured_axes, list) else [])
                if canonical_axis_code(axis)
            }
            axis_codes.update(
                canonical_axis_code(item.get("axisCode"))
                for item in scoped_exports
                if canonical_axis_code(item.get("axisCode"))
            )
            expected_pdf_count = sample_count * max(len(axis_codes), 1)
            missing_count = max(expected_pdf_count - success_count - failed_count, 0) if completed else 0
            folder = _experiment_folder(root, task_code, experiment, scoped_exports)
            experiment_items.append(
                {
                    "experimentCode": experiment_code,
                    "experimentName": _text(experiment.get("experiment_name") or experiment.get("name")) or experiment_code,
                    "status": status,
                    "completed": completed,
                    "successfulPdfCount": success_count,
                    "failedPdfCount": failed_count,
                    "missingPdfCount": missing_count,
                    "folderAvailable": folder.is_dir(),
                }
            )
        total_count = len(experiment_items)
        completed_count = sum(1 for item in experiment_items if item["completed"])
        task_folder = _task_folder(root, task_code, exports)
        items.append(
            {
                "taskCode": task_code,
                "taskName": task_name,
                "totalExperimentCount": total_count,
                "completedExperimentCount": completed_count,
                "progressPercent": round(completed_count * 100 / total_count) if total_count else 0,
                "successfulPdfCount": sum(item["successfulPdfCount"] for item in experiment_items),
                "failedPdfCount": sum(item["failedPdfCount"] for item in experiment_items),
                "missingPdfCount": sum(item["missingPdfCount"] for item in experiment_items),
                "folderAvailable": task_folder.is_dir(),
                "experiments": experiment_items,
            }
        )

    total = len(items)
    safe_page_size = min(max(int(page_size), 1), 100)
    safe_page = max(int(page), 1)
    start = (safe_page - 1) * safe_page_size
    return {
        "items": items[start : start + safe_page_size],
        "total": total,
        "page": safe_page,
        "pageSize": safe_page_size,
    }


def resolve_experiment_folder(*, storage: Any, task_code: str, experiment_code: str) -> Path:
    normalized_task = _text(task_code)
    normalized_experiment = _text(experiment_code)
    data = _storage_many(storage, ["mes.experiments"])
    experiment = next(
        (
            row
            for row in _rows(data.get("mes.experiments"))
            if _text(row.get("task_code") or row.get("task_no")) == normalized_task
            and _experiment_code(row) == normalized_experiment
        ),
        None,
    )
    exports = get_test_data_repository(storage).list_exports()
    if experiment is None:
        experiment = next(
            (
                {
                    "experiment_code": normalized_experiment,
                    "experiment_name": row.get("experimentName"),
                }
                for row in exports
                if _text(row.get("taskCode")) == normalized_task
                and _text(row.get("experimentCode")) == normalized_experiment
            ),
            None,
        )
    if experiment is None:
        raise FileNotFoundError("未找到对应试验")
    root = Path(read_test_data_settings(storage=storage)["savePath"]).resolve(strict=False)
    return _experiment_folder(root, normalized_task, experiment, exports)


def resolve_task_folder(*, storage: Any, task_code: str) -> Path:
    normalized_task = _text(task_code)
    if not normalized_task:
        raise FileNotFoundError("任务编号不能为空")
    data = _storage_many(storage, ["mes.tasks", "mes.experiments"])
    exports = get_test_data_repository(storage).list_exports()
    known = any(_task_code(row) == normalized_task for row in _rows(data.get("mes.tasks")))
    known = known or any(
        _text(row.get("task_code") or row.get("task_no")) == normalized_task
        for row in _rows(data.get("mes.experiments"))
    )
    known = known or any(_text(row.get("taskCode")) == normalized_task for row in exports)
    if not known:
        raise FileNotFoundError("未找到对应任务")
    root = Path(read_test_data_settings(storage=storage)["savePath"]).resolve(strict=False)
    return _task_folder(root, normalized_task, exports)


def open_experiment_folder(*, storage: Any, task_code: str, experiment_code: str) -> Path:
    folder = resolve_experiment_folder(storage=storage, task_code=task_code, experiment_code=experiment_code)
    if not folder.is_dir():
        raise FileNotFoundError("该试验尚未生成数据目录")
    if os.name != "nt":
        raise RuntimeError("打开目录仅支持运行 MES 后端的 Windows 主机")
    os.startfile(str(folder))  # type: ignore[attr-defined]
    return folder


def open_task_folder(*, storage: Any, task_code: str) -> Path:
    folder = resolve_task_folder(storage=storage, task_code=task_code)
    if not folder.is_dir():
        raise FileNotFoundError("该任务尚未生成数据目录")
    if os.name != "nt":
        raise RuntimeError("打开目录仅支持运行 MES 后端的 Windows 主机")
    os.startfile(str(folder))  # type: ignore[attr-defined]
    return folder


def create_experiment_share(*, storage: Any, task_code: str, experiment_code: str, public_base_url: str) -> dict[str, Any]:
    resolve_experiment_folder(storage=storage, task_code=task_code, experiment_code=experiment_code)
    share = get_test_data_repository(storage).get_or_create_share(task_code, experiment_code)
    base = _text(public_base_url).rstrip("/")
    if not base:
        raise ValueError("未配置局域网下载地址")
    share["url"] = f"{base}/api/test-data/share/{quote(_text(share.get('token')), safe='')}"
    return share


def create_task_share(*, storage: Any, task_code: str, public_base_url: str) -> dict[str, Any]:
    folder = resolve_task_folder(storage=storage, task_code=task_code)
    if not folder.is_dir():
        raise FileNotFoundError("该任务尚未生成数据目录")
    repository = get_test_data_repository(storage)
    if not any(
        _text(record.get("taskCode")) == _text(task_code)
        for record in repository.list_exports(status="success")
    ):
        raise FileNotFoundError("该任务暂无可分享的 PDF")
    share = repository.get_or_create_share(task_code, "")
    base = _text(public_base_url).rstrip("/")
    if not base:
        raise ValueError("未配置局域网下载地址")
    share["url"] = f"{base}/api/test-data/share/{quote(_text(share.get('token')), safe='')}"
    return share


def share_files(*, storage: Any, token: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    repository = get_test_data_repository(storage)
    share = repository.find_share(token)
    if not share:
        raise FileNotFoundError("分享地址不存在或已失效")
    root = Path(read_test_data_settings(storage=storage)["savePath"]).resolve(strict=False)
    items: list[dict[str, Any]] = []
    for record in repository.list_exports(status="success"):
        if _text(record.get("taskCode")) != _text(share.get("taskCode")):
            continue
        shared_experiment = _text(share.get("experimentCode"))
        if shared_experiment and _text(record.get("experimentCode")) != shared_experiment:
            continue
        file_path = _text(record.get("filePath"))
        if not file_path:
            continue
        try:
            path = _ensure_within_root(root, Path(file_path))
        except ValueError:
            continue
        if not path.is_file():
            continue
        relative_path = path.relative_to(root)
        archive_name = path.name
        if not shared_experiment and len(relative_path.parts) > 1:
            archive_name = Path(*relative_path.parts[1:]).as_posix()
        items.append(
            {
                "exportKey": _text(record.get("exportKey")),
                "sampleCode": _text(record.get("sampleCode")),
                "axisCode": _text(record.get("axisCode")),
                "fileName": path.name,
                "archiveName": archive_name,
                "filePath": path,
                "size": path.stat().st_size,
            }
        )
    return share, items


def resolve_shared_file(*, storage: Any, token: str, export_key: str) -> tuple[Path, str]:
    _, files = share_files(storage=storage, token=token)
    item = next((row for row in files if _text(row.get("exportKey")) == _text(export_key)), None)
    if not item:
        raise FileNotFoundError("分享文件不存在")
    return Path(item["filePath"]), _text(item.get("fileName"))


def render_share_page(*, storage: Any, token: str) -> str:
    share, files = share_files(storage=storage, token=token)
    token_path = quote(token, safe="")
    scope_label = html.escape(_text(share.get("taskCode")))
    if _text(share.get("experimentCode")):
        scope_label = f"{scope_label} / {html.escape(_text(share.get('experimentCode')))}"
    file_rows = "".join(
        "<li><a href=\"{url}\">{name}</a><span>{size} B</span></li>".format(
            url=f"/api/test-data/share/{token_path}/files/{quote(_text(item.get('exportKey')), safe='')}",
            name=html.escape(_text(item.get("fileName"))),
            size=int(item.get("size") or 0),
        )
        for item in files
    ) or "<li><span>暂无可下载的 PDF 文件</span></li>"
    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MES 试验数据</title><style>
body{{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#172b3a}}
h1{{font-size:24px}}p{{color:#607585}}ul{{padding:0;list-style:none}}li{{display:flex;justify-content:space-between;gap:16px;padding:14px;border-bottom:1px solid #dce5eb}}
a{{color:#087ca7}}.archive{{display:inline-block;margin:14px 0;padding:10px 14px;background:#087ca7;color:white;text-decoration:none;border-radius:6px}}
</style></head><body><h1>MES 试验数据</h1>
<p>{scope_label}</p>
<a class="archive" href="/api/test-data/share/{token_path}/archive.zip">下载全部 ZIP</a><ul>{file_rows}</ul></body></html>"""


def create_share_archive(*, storage: Any, token: str) -> tuple[Path, str]:
    share, files = share_files(storage=storage, token=token)
    descriptor, temporary_name = tempfile.mkstemp(prefix="mes-test-data-", suffix=".zip")
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            used_names: set[str] = set()
            for item in files:
                name = _text(item.get("archiveName") or item.get("fileName"))
                if name in used_names:
                    path = Path(name)
                    name = str(path.with_name(f"{safe_path_segment(item.get('sampleCode'))}-{path.name}")).replace("\\", "/")
                used_names.add(name)
                archive.write(Path(item["filePath"]), arcname=name)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    name_parts = [safe_path_segment(share.get("taskCode"))]
    if _text(share.get("experimentCode")):
        name_parts.append(safe_path_segment(share.get("experimentCode")))
    download_name = f"{'-'.join(name_parts)}.zip"
    return temporary, download_name


def clear_test_data_metadata(*, storage: Any) -> None:
    get_test_data_repository(storage).clear_metadata()
