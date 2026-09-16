"""Archive received data against the canceled run, including late result messages."""
import hashlib
import json
from threading import RLock
from app.core.time_utils import parse_business_datetime

from app.services.device_fault_cancellation import FAULT_CANCELED, text
from app.services.laboratory_snapshot_adapter import snapshot_from_storage_payload
from app.services.test_data_reports import archive_completion_reports

_ARCHIVE_LOCK = RLock()


def archive_device_fault_reports(storage, *, run_no: str, command: dict | None = None):
    # Serialize the read+render cycle so a slower older callback cannot replace a late result.
    with _ARCHIVE_LOCK:
        return _archive_device_fault_reports(storage, run_no=run_no, command=command)


def _archive_device_fault_reports(storage, *, run_no: str, command: dict | None = None):
    payload = storage.read_all()
    archive_task = next((row for row in payload.get("mes.conflicts", []) if text(row.get("id")) == f"device-fault-archive-{run_no}"), {})
    if archive_task:
        from app.services.laboratory_operations import acquire_laboratory_storage_commit_lock
        with acquire_laboratory_storage_commit_lock():
            tasks = storage.read("mes.conflicts")
            for task in tasks:
                if text(task.get("id")) == f"device-fault-archive-{run_no}":
                    task["status"] = "pending"
            storage.write("mes.conflicts", tasks)
    command = command or archive_task.get("archive_command") or {}
    snapshot = snapshot_from_storage_payload(payload)
    run = next((row for row in snapshot["experiment_runs"] if text(row.get("run_no") or row.get("id")) == run_no), None)
    if not run or text(run.get("status")) != FAULT_CANCELED:
        return {"ok": False, "error": "未找到设备故障取消运行"}
    results = []
    if callable(getattr(storage, "_connect", None)):
        with storage._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("""SELECT result.result_payload_json FROM biz_experiment_result result
                    LEFT JOIN biz_mq_message_log message ON message.message_log_id=result.message_log_id
                    WHERE result.task_no=%s AND result.experiment_no=%s
                      AND (JSON_UNQUOTE(JSON_EXTRACT(result.result_payload_json,'$.run_no'))=%s
                        OR JSON_UNQUOTE(JSON_EXTRACT(message.payload_json,'$.run_no'))=%s
                        OR JSON_UNQUOTE(JSON_EXTRACT(message.payload_json,'$.runNo'))=%s)
                    ORDER BY result.result_time, result.message_id""",
                    (run["task_code"], run["experiment_code"], run_no, run_no, run_no))
                for row in cursor.fetchall():
                    value = row.get("result_payload_json")
                    results.append(json.loads(value) if isinstance(value, str) else value)
    else:
        results = [row for row in payload.get("mes.experiment_results", []) if text(row.get("run_no")) == run_no]
    history = next((entry for sample in snapshot["samples"] for entry in sample.get("history", [])
                    if (text(entry.get("run_no")) == run_no or text(entry.get("detail")).endswith(f" / 运行批次：{run_no}"))
                    and entry.get("action") == FAULT_CANCELED), {})
    metadata = {"terminalStatus": FAULT_CANCELED, "cancelReason": text((command or {}).get("cancel_reason")) or text(history.get("detail")),
                "operator": text((command or {}).get("operator")) or text(history.get("owner")),
                "axisSteps": [row for row in snapshot["experiment_run_steps"] if text(row.get("run_no")) == run_no],
                "resultPackages": results, "resultCompleteness": "已接收结果已保存（不代表完整试验结论）" if results else "尚未收到上位机结果，待补齐"}
    started = parse_business_datetime(run.get("started_at"))
    ended = parse_business_datetime(run.get("ended_at"))
    metadata["elapsedSeconds"] = max(0, int((ended - started).total_seconds())) if started and ended else None
    if (command or {}).get("schedule_snapshot"):
        metadata["originalSchedule"] = command["schedule_snapshot"]
    metadata["resultRevision"] = hashlib.sha256(json.dumps(results, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()
    result = archive_completion_reports(snapshot=snapshot,
        result={"samples": snapshot["samples"], "experimentRuns": snapshot["experiment_runs"],
                "experimentRunTrays": snapshot["experiment_run_trays"]},
        task_code=run["task_code"], experiment_code=run["experiment_code"], run_no=run_no,
        completed_at=run.get("ended_at", ""), report_metadata=metadata)
    if archive_task:
        from app.services.laboratory_operations import acquire_laboratory_storage_commit_lock
        with acquire_laboratory_storage_commit_lock():
            conflicts = storage.read("mes.conflicts")
            for row in conflicts:
                if text(row.get("id")) == f"device-fault-archive-{run_no}":
                    row["status"] = "resolved" if result.get("ok") else "pending"
                    row["reason"] = "设备故障取消结果已归档" if result.get("ok") else "设备故障取消结果归档失败，请在试验数据页重试"
            storage.write("mes.conflicts", conflicts)
    return result


def retry_device_fault_archives(storage, *, export_keys=None):
    requested_runs = {text(key).split("|", 1)[0] for key in export_keys or []}
    outcomes = []
    for task in storage.read("mes.conflicts"):
        if task.get("type") != "device_fault_archive_pending" or task.get("status") != "pending":
            continue
        run_no = text(task.get("run_no"))
        if requested_runs and run_no not in requested_runs:
            continue
        try:
            outcomes.append(archive_device_fault_reports(storage, run_no=run_no))
        except Exception as exc:
            outcomes.append({"ok": False, "failed": 1, "error": str(exc), "runNo": run_no})
    return outcomes
