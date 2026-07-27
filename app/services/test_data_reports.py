from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path
from threading import RLock
from typing import Any, Iterable
from uuid import uuid4

from app.core.axis_codes import canonical_axis_code
from app.core.storage_backend import get_storage_backend
from app.core.time_utils import format_business_datetime, now_business_text, parse_business_datetime
from app.services.test_data_repository import get_test_data_repository


SETTINGS_STORAGE_KEY = "mes.test_data_settings"
EXPORTS_STORAGE_KEY = "mes.test_data_exports"
DEFAULT_FOLDER_NAME = "MES试验数据"

_INVALID_WINDOWS_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}
_PERSISTENCE_LOCK = RLock()
_FONT_LOCK = RLock()
_REGISTERED_FONT = ""


def default_save_path() -> Path:
    return Path.home() / "Desktop" / DEFAULT_FOLDER_NAME


def _text(value: Any) -> str:
    return str(value or "").strip()


def _dict_rows(value: Any) -> list[dict[str, Any]]:
    return [dict(item) for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _storage_read_list(storage: Any, key: str) -> list[dict[str, Any]]:
    return _dict_rows(storage.read(key))


def safe_path_segment(value: Any, *, fallback: str = "未命名") -> str:
    segment = _INVALID_WINDOWS_CHARS.sub("_", _text(value))
    segment = re.sub(r"\s+", " ", segment).strip().rstrip(". ")
    if not segment:
        segment = fallback
    if segment.upper() in _WINDOWS_RESERVED_NAMES:
        segment = f"{segment}_"
    return segment[:120].rstrip(". ") or fallback


def axis_folder_name(axis_code: Any) -> str:
    normalized = canonical_axis_code(axis_code)
    return f"{normalized.upper()}轴向" if normalized else ""


def batch_folder_name(started_at: Any, ended_at: Any) -> str:
    start = parse_business_datetime(started_at)
    end = parse_business_datetime(ended_at)
    if start is None and end is None:
        return "时间未知"
    start = start or end
    end = end or start
    assert start is not None and end is not None
    if start.date() == end.date():
        return f"{start:%Y-%m-%d %H.%M}-{end:%H.%M}"
    return f"{start:%Y-%m-%d %H.%M}-{end:%Y-%m-%d %H.%M}"


def _ensure_within_root(root: Path, candidate: Path) -> Path:
    resolved_root = root.expanduser().resolve(strict=False)
    resolved_candidate = candidate.expanduser().resolve(strict=False)
    try:
        resolved_candidate.relative_to(resolved_root)
    except ValueError as exc:
        raise ValueError("报告输出路径超出试验数据保存目录") from exc
    return resolved_candidate


def validate_save_path(value: Any) -> Path:
    text = _text(value)
    if not text:
        raise ValueError("保存地址不能为空")
    path = Path(text).expanduser()
    if not path.is_absolute():
        raise ValueError("保存地址必须是绝对路径")
    try:
        path.mkdir(parents=True, exist_ok=True)
        if not path.is_dir():
            raise ValueError("保存地址不是文件夹")
        file_descriptor, probe_name = tempfile.mkstemp(prefix=".mes-write-probe-", dir=path)
        try:
            os.write(file_descriptor, b"MES")
            os.fsync(file_descriptor)
        finally:
            os.close(file_descriptor)
            Path(probe_name).unlink(missing_ok=True)
    except ValueError:
        raise
    except OSError as exc:
        raise ValueError(f"保存地址不可写：{exc}") from exc
    return path.resolve(strict=False)


def _path_health(path: Path) -> tuple[bool, str]:
    try:
        validate_save_path(path)
    except ValueError as exc:
        return False, str(exc)
    return True, "目录可写"


def read_test_data_settings(*, storage: Any | None = None) -> dict[str, Any]:
    backend = storage or get_storage_backend()
    records = _storage_read_list(backend, SETTINGS_STORAGE_KEY)
    configured = _text(records[0].get("savePath")) if records else ""
    save_path = Path(configured).expanduser() if configured else default_save_path()
    writable, detail = _path_health(save_path)
    return {
        "savePath": str(save_path.resolve(strict=False)),
        "defaultPath": str(default_save_path().resolve(strict=False)),
        "writable": writable,
        "detail": detail,
        "updatedAt": _text(records[0].get("updatedAt")) if records else "",
    }


def update_test_data_settings(save_path: Any, *, storage: Any | None = None) -> dict[str, Any]:
    backend = storage or get_storage_backend()
    validated = validate_save_path(save_path)
    updated_at = now_business_text()
    with _PERSISTENCE_LOCK:
        backend.write(SETTINGS_STORAGE_KEY, [{"savePath": str(validated), "updatedAt": updated_at}])
    return {
        "savePath": str(validated),
        "defaultPath": str(default_save_path().resolve(strict=False)),
        "writable": True,
        "detail": "目录可写",
        "updatedAt": updated_at,
    }


def list_export_records(*, storage: Any | None = None, status: str = "") -> list[dict[str, Any]]:
    backend = storage or get_storage_backend()
    return get_test_data_repository(backend).list_exports(status=status)


def _find_by_run(rows: Iterable[dict[str, Any]], task_code: str, experiment_code: str, run_no: str) -> dict[str, Any]:
    return next(
        (
            row
            for row in rows
            if _text(row.get("run_no") or row.get("runNo") or row.get("id")) == run_no
            and _text(row.get("task_code") or row.get("task_no")) == task_code
            and _text(row.get("experiment_code") or row.get("experiment_no")) == experiment_code
        ),
        {},
    )


def _find_axis_step(
    rows: Iterable[dict[str, Any]],
    task_code: str,
    experiment_code: str,
    run_no: str,
    axis_code: str,
) -> dict[str, Any]:
    normalized_axis = canonical_axis_code(axis_code)
    return next(
        (
            row
            for row in rows
            if _text(row.get("run_no") or row.get("runNo")) == run_no
            and _text(row.get("task_code") or row.get("task_no")) == task_code
            and _text(row.get("experiment_code") or row.get("experiment_no")) == experiment_code
            and canonical_axis_code(row.get("axis_code") or row.get("axisCode")) == normalized_axis
        ),
        {},
    )


def _run_tray_codes(
    snapshot: dict[str, Any],
    result: dict[str, Any],
    *,
    task_code: str,
    experiment_code: str,
    run_no: str,
) -> set[str]:
    rows = [
        *_dict_rows(result.get("experimentRunTrays")),
        *_dict_rows(snapshot.get("experiment_run_trays")),
    ]
    return {
        _text(row.get("tray_code") or row.get("tray_no") or row.get("trayCode"))
        for row in rows
        if _text(row.get("run_no") or row.get("runNo")) == run_no
        and _text(row.get("task_code") or row.get("task_no")) == task_code
        and _text(row.get("experiment_code") or row.get("experiment_no")) == experiment_code
        and _text(row.get("tray_code") or row.get("tray_no") or row.get("trayCode"))
    }


def _sample_tray_codes(sample: dict[str, Any]) -> set[str]:
    codes = {
        _text(sample.get("tray_code") or sample.get("tray_no") or sample.get("trayCode"))
    }
    codes.update(
        _text(tray.get("tray_code") or tray.get("tray_no") or tray.get("trayCode"))
        for tray in _dict_rows(sample.get("trays"))
    )
    return {code for code in codes if code}


def _affected_samples(
    snapshot: dict[str, Any],
    result: dict[str, Any],
    *,
    task_code: str,
    experiment_code: str,
    run_no: str,
) -> list[dict[str, Any]]:
    batch_trays = _run_tray_codes(
        snapshot,
        result,
        task_code=task_code,
        experiment_code=experiment_code,
        run_no=run_no,
    )
    result_trays = {_text(code) for code in result.get("affectedTrayCodes", []) if _text(code)}
    if result_trays:
        batch_trays = batch_trays & result_trays if batch_trays else result_trays

    scoped_sample_codes = {
        _text(row.get("sample_code") or row.get("sample_no") or row.get("sampleCode"))
        for row in _dict_rows(snapshot.get("experiment_samples"))
        if _text(row.get("task_code") or row.get("task_no")) == task_code
        and _text(row.get("experiment_code") or row.get("experiment_no")) == experiment_code
        and _text(row.get("sample_code") or row.get("sample_no") or row.get("sampleCode"))
    }
    samples = _dict_rows(result.get("samples")) or _dict_rows(snapshot.get("samples"))
    selected: list[dict[str, Any]] = []
    seen: set[str] = set()
    for sample in samples:
        sample_code = _text(sample.get("code") or sample.get("sample_code") or sample.get("sample_no"))
        sample_task_code = _text(sample.get("task_code") or sample.get("task_no"))
        if not sample_code or sample_code in seen or sample_task_code != task_code:
            continue
        if scoped_sample_codes and sample_code not in scoped_sample_codes:
            continue
        if batch_trays and not (_sample_tray_codes(sample) & batch_trays):
            continue
        selected.append(sample)
        seen.add(sample_code)
    return selected


def _report_context(
    snapshot: dict[str, Any],
    result: dict[str, Any],
    *,
    task_code: str,
    experiment_code: str,
    run_no: str,
    axis_code: str,
    completed_at: str,
) -> dict[str, str]:
    runs = [*_dict_rows(result.get("experimentRuns")), *_dict_rows(snapshot.get("experiment_runs"))]
    run = _find_by_run(runs, task_code, experiment_code, run_no)
    axis_step = {}
    if axis_code:
        steps = [*_dict_rows(result.get("experimentRunSteps")), *_dict_rows(snapshot.get("experiment_run_steps"))]
        axis_step = _find_axis_step(steps, task_code, experiment_code, run_no, axis_code)
    timing_record = axis_step if axis_step else run
    started_at = format_business_datetime(timing_record.get("started_at") or timing_record.get("startedAt"))
    ended_at = format_business_datetime(
        timing_record.get("ended_at") or timing_record.get("endedAt") or completed_at or result.get("completedAt")
    )

    experiments = [*_dict_rows(result.get("experiments")), *_dict_rows(snapshot.get("experiments"))]
    experiment = next(
        (
            row
            for row in experiments
            if _text(row.get("task_code") or row.get("task_no")) == task_code
            and _text(row.get("experiment_code") or row.get("experiment_no")) == experiment_code
        ),
        {},
    )
    experiment_name = _text(
        experiment.get("experiment_name")
        or experiment.get("experiment_type")
        or experiment.get("required_device")
        or experiment_code
    )

    schedule_id = _text(run.get("schedule_id") or run.get("scheduleId"))
    schedules = [*_dict_rows(result.get("schedules")), *_dict_rows(snapshot.get("schedules"))]
    schedule = next(
        (
            row
            for row in schedules
            if (schedule_id and _text(row.get("id") or row.get("schedule_id") or row.get("scheduleId")) == schedule_id)
            or (
                not schedule_id
                and _text(row.get("task_code") or row.get("task_no")) == task_code
                and _text(row.get("experiment_code") or row.get("experiment_no")) == experiment_code
            )
        ),
        {},
    )
    laboratory = _text(
        run.get("lab_name")
        or run.get("laboratory")
        or run.get("device")
        or schedule.get("lab_name")
        or schedule.get("laboratory")
        or schedule.get("device")
        or experiment.get("required_device")
    )
    return {
        "taskCode": task_code,
        "experimentCode": experiment_code,
        "experimentName": experiment_name,
        "laboratory": laboratory,
        "runNo": run_no,
        "axisCode": canonical_axis_code(axis_code),
        "startedAt": started_at,
        "endedAt": ended_at,
    }


def _font_name() -> str:
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
        from reportlab.pdfbase.ttfonts import TTFont
    except ImportError as exc:
        raise RuntimeError("PDF 生成依赖 reportlab 未安装，请先安装 requirements.txt") from exc

    global _REGISTERED_FONT
    if _REGISTERED_FONT:
        return _REGISTERED_FONT
    with _FONT_LOCK:
        if _REGISTERED_FONT:
            return _REGISTERED_FONT
        candidates = (
            Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "msyh.ttc",
            Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "simhei.ttf",
            Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "simsun.ttc",
        )
        for candidate in candidates:
            if not candidate.is_file():
                continue
            try:
                pdfmetrics.registerFont(TTFont("MESChinese", str(candidate)))
                _REGISTERED_FONT = "MESChinese"
                return _REGISTERED_FONT
            except Exception:
                continue
        try:
            pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
            _REGISTERED_FONT = "STSong-Light"
        except Exception:
            _REGISTERED_FONT = "Helvetica"
        return _REGISTERED_FONT


def _write_report_pdf(path: Path, record: dict[str, Any]) -> None:
    try:
        from reportlab.lib.colors import HexColor
        from reportlab.lib.pagesizes import A4
        from reportlab.pdfgen import canvas
    except ImportError as exc:
        raise RuntimeError("PDF 生成依赖 reportlab 未安装，请先安装 requirements.txt") from exc

    font_name = _font_name()
    document = canvas.Canvas(str(path), pagesize=A4, pageCompression=1)
    width, height = A4
    document.setTitle(f"{record['taskCode']} - {record['sampleCode']} 试验数据")
    document.setAuthor("MES")
    document.setFillColor(HexColor("#16324F"))
    document.rect(0, height - 112, width, 112, fill=1, stroke=0)
    document.setFillColor(HexColor("#FFFFFF"))
    document.setFont(font_name, 22)
    document.drawString(48, height - 70, "MES 试验数据报告")
    document.setFont(font_name, 10)
    document.drawString(49, height - 92, "自动归档文件")

    rows = (
        ("样品编号", record.get("sampleCode")),
        ("任务编号", record.get("taskCode")),
        ("试验类型", record.get("experimentName")),
        ("实验室/设备", record.get("laboratory") or "-"),
        ("运行批次", record.get("runNo")),
        ("轴向信息", axis_folder_name(record.get("axisCode")) or "非轴向试验"),
        ("实际开始时间", record.get("startedAt") or "-"),
        ("实际结束时间", record.get("endedAt") or "-"),
        ("报告生成时间", record.get("generatedAt")),
    )
    y = height - 156
    for index, (label, value) in enumerate(rows):
        if index % 2 == 0:
            document.setFillColor(HexColor("#F4F7FA"))
            document.rect(42, y - 20, width - 84, 36, fill=1, stroke=0)
        document.setFillColor(HexColor("#476072"))
        document.setFont(font_name, 10)
        document.drawString(56, y - 5, label)
        document.setFillColor(HexColor("#12212B"))
        document.setFont(font_name, 11)
        document.drawString(170, y - 5, _text(value)[:80])
        y -= 42

    document.setStrokeColor(HexColor("#CBD6DE"))
    document.line(42, 54, width - 42, 54)
    document.setFillColor(HexColor("#6B7F8D"))
    document.setFont(font_name, 8)
    document.drawString(42, 38, f"MES 自动生成 | {record.get('exportKey', '')}")
    document.drawRightString(width - 42, 38, "第 1 页 / 共 1 页")
    document.showPage()
    document.save()


def _relative_report_path(record: dict[str, Any]) -> Path:
    segments = [
        safe_path_segment(record.get("taskCode")),
        safe_path_segment(record.get("experimentName") or record.get("experimentCode")),
    ]
    axis_folder = axis_folder_name(record.get("axisCode"))
    if axis_folder:
        segments.append(safe_path_segment(axis_folder))
    segments.extend(
        (
            safe_path_segment(batch_folder_name(record.get("startedAt"), record.get("endedAt"))),
            f"{safe_path_segment(record.get('sampleCode'), fallback='样品')}.pdf",
        )
    )
    return Path(*segments)


def _render_export_record(root: Path, record: dict[str, Any]) -> Path:
    root = root.resolve(strict=False)
    relative_path = _relative_report_path(record)
    target = _ensure_within_root(root, root / relative_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target = _ensure_within_root(root, target)
    temporary = target.with_name(f".{target.name}.{uuid4().hex}.tmp")
    temporary = _ensure_within_root(root, temporary)
    try:
        _write_report_pdf(temporary, record)
        with temporary.open("r+b") as stream:
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return target


def _persist_exports(storage: Any, records: list[dict[str, Any]]) -> None:
    storage.write(EXPORTS_STORAGE_KEY, records)


def archive_completion_reports(
    *,
    snapshot: dict[str, Any],
    result: dict[str, Any],
    task_code: str,
    experiment_code: str,
    run_no: str,
    axis_code: str = "",
    completed_at: str = "",
) -> dict[str, Any]:
    """Generate one PDF per affected sample and never interrupt completion."""
    attempted = succeeded = skipped = failed = 0
    items: list[dict[str, Any]] = []
    try:
        backend = get_storage_backend()
        normalized_task = _text(task_code)
        normalized_experiment = _text(experiment_code)
        normalized_run = _text(run_no)
        normalized_axis = canonical_axis_code(axis_code)
        if not normalized_task or not normalized_experiment or not normalized_run:
            raise ValueError("task_code、experiment_code 和 run_no 不能为空")

        settings = read_test_data_settings(storage=backend)
        root = Path(settings["savePath"])
        context = _report_context(
            snapshot,
            result,
            task_code=normalized_task,
            experiment_code=normalized_experiment,
            run_no=normalized_run,
            axis_code=normalized_axis,
            completed_at=completed_at,
        )
        samples = _affected_samples(
            snapshot,
            result,
            task_code=normalized_task,
            experiment_code=normalized_experiment,
            run_no=normalized_run,
        )
        if not samples:
            return {
                "ok": False,
                "attempted": 0,
                "succeeded": 0,
                "skipped": 0,
                "failed": 1,
                "items": [],
                "error": "当前批次未找到可归档的样品",
            }
        generated_at = now_business_text()
        with _PERSISTENCE_LOCK:
            repository = get_test_data_repository(backend)
            records = repository.list_exports()
            indexes = {_text(item.get("exportKey")): index for index, item in enumerate(records)}
            for sample in samples:
                sample_code = _text(sample.get("code") or sample.get("sample_code") or sample.get("sample_no"))
                export_key = f"{normalized_run}|{normalized_axis}|{sample_code}"
                current_index = indexes.get(export_key)
                current = dict(records[current_index]) if current_index is not None else {}
                current_path = Path(_text(current.get("filePath"))) if _text(current.get("filePath")) else None
                if _text(current.get("status")) == "success" and current_path is not None and current_path.is_file():
                    skipped += 1
                    items.append(current)
                    continue

                attempted += 1
                record = {
                    **current,
                    **context,
                    "exportKey": export_key,
                    "sampleCode": sample_code,
                    "status": "pending",
                    "generatedAt": current.get("generatedAt") or generated_at,
                    "updatedAt": generated_at,
                    "attempts": int(current.get("attempts") or 0) + 1,
                    "error": "",
                }
                try:
                    target = _render_export_record(root, record)
                    record.update(
                        {
                            "status": "success",
                            "filePath": str(target),
                            "relativePath": str(target.relative_to(root.resolve(strict=False))),
                            "error": "",
                        }
                    )
                    succeeded += 1
                except Exception as exc:
                    record.update({"status": "failed", "filePath": "", "error": str(exc)})
                    failed += 1
                if current_index is None:
                    indexes[export_key] = len(records)
                    records.append(record)
                else:
                    records[current_index] = record
                repository.upsert_export(record)
                items.append(record)
    except Exception as exc:
        failed += 1
        return {
            "ok": False,
            "attempted": attempted,
            "succeeded": succeeded,
            "skipped": skipped,
            "failed": failed,
            "items": items,
            "error": str(exc),
        }
    return {
        "ok": failed == 0,
        "attempted": attempted,
        "succeeded": succeeded,
        "skipped": skipped,
        "failed": failed,
        "items": items,
        "error": "",
    }


def retry_failed_exports(*, export_keys: Iterable[str] | None = None, storage: Any | None = None) -> dict[str, Any]:
    backend = storage or get_storage_backend()
    requested = {_text(key) for key in export_keys or [] if _text(key)}
    attempted = succeeded = failed = 0
    items: list[dict[str, Any]] = []
    try:
        root = Path(read_test_data_settings(storage=backend)["savePath"])
        with _PERSISTENCE_LOCK:
            repository = get_test_data_repository(backend)
            records = repository.list_exports()
            for index, current_record in enumerate(records):
                if _text(current_record.get("status")) != "failed":
                    continue
                if requested and _text(current_record.get("exportKey")) not in requested:
                    continue
                attempted += 1
                updated_at = now_business_text()
                record = {
                    **current_record,
                    "updatedAt": updated_at,
                    "attempts": int(current_record.get("attempts") or 0) + 1,
                    "error": "",
                }
                try:
                    target = _render_export_record(root, record)
                    record.update(
                        {
                            "status": "success",
                            "filePath": str(target),
                            "relativePath": str(target.relative_to(root.resolve(strict=False))),
                        }
                    )
                    succeeded += 1
                except Exception as exc:
                    record.update({"status": "failed", "filePath": "", "error": str(exc)})
                    failed += 1
                records[index] = record
                repository.upsert_export(record)
                items.append(record)
    except Exception as exc:
        return {
            "ok": False,
            "attempted": attempted,
            "succeeded": succeeded,
            "failed": failed + 1,
            "items": items,
            "error": str(exc),
        }
    return {
        "ok": failed == 0,
        "attempted": attempted,
        "succeeded": succeeded,
        "failed": failed,
        "items": items,
        "error": "",
    }
