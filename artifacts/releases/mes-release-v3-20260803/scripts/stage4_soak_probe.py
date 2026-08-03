from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import time
from typing import Any
import urllib.request


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.stage3a_load_probe import DEFAULT_ENDPOINTS, capture_data_profile, run_probe


RETENTION_MANAGED_PROFILE_KEYS = {"mes.staging_events"}
RETENTION_RESULT_KEYS = (
    "biz_mq_message_log",
    "biz_experiment_event",
    "mes.staging_events",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def capture_json(url: str, timeout_seconds: float, user_agent: str) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": user_agent},
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError(f"endpoint did not return an object: {url}")
    return payload


def capture_capacity(base_url: str, timeout_seconds: float) -> dict[str, Any]:
    return capture_json(
        f"{base_url.rstrip('/')}/health/capacity",
        timeout_seconds,
        "MES-Stage4-Soak/2.0",
    )


def capture_readiness(base_url: str, timeout_seconds: float) -> dict[str, Any]:
    return capture_json(
        f"{base_url.rstrip('/')}/health/ready",
        timeout_seconds,
        "MES-Stage4-Soak/2.0",
    )


def _run_docker(arguments: list[str]) -> str:
    result = subprocess.run(
        ["docker", *arguments],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"docker {' '.join(arguments[:2])} failed: {result.stderr.strip()}")
    return result.stdout


def _percent(value: object) -> float:
    return float(str(value or "0").strip().rstrip("%") or 0)


def capture_docker_sample(project_name: str) -> dict[str, Any]:
    if not project_name:
        return {}
    ids = [
        value.strip()
        for value in _run_docker(
            ["ps", "-a", "--filter", f"label=com.docker.compose.project={project_name}", "--format", "{{.ID}}"]
        ).splitlines()
        if value.strip()
    ]
    if not ids:
        raise RuntimeError(f"no Docker containers found for project {project_name}")
    inspected = json.loads(_run_docker(["inspect", *ids]))
    if not isinstance(inspected, list):
        raise RuntimeError("docker inspect did not return a list")
    containers: dict[str, dict[str, Any]] = {}
    running_ids: list[str] = []
    for item in inspected:
        labels = item.get("Config", {}).get("Labels", {})
        if labels.get("com.docker.compose.project") != project_name:
            raise RuntimeError("Docker project label mismatch")
        state = item.get("State", {})
        service = str(labels.get("com.docker.compose.service") or "")
        name = str(item.get("Name") or "").lstrip("/")
        if state.get("Running"):
            running_ids.append(str(item.get("Id")))
        containers[name] = {
            "id": str(item.get("Id") or ""),
            "service": service,
            "imageReference": str(item.get("Config", {}).get("Image") or ""),
            "imageId": str(item.get("Image") or ""),
            "status": str(state.get("Status") or ""),
            "running": bool(state.get("Running")),
            "oomKilled": bool(state.get("OOMKilled")),
            "dead": bool(state.get("Dead")),
            "exitCode": int(state.get("ExitCode") or 0),
            "restartCount": int(item.get("RestartCount") or 0),
            "health": str((state.get("Health") or {}).get("Status") or ""),
            "logConfig": item.get("HostConfig", {}).get("LogConfig", {}),
        }
    if running_ids:
        raw_stats = _run_docker(["stats", "--no-stream", "--format", "{{json .}}", *running_ids])
        for line in raw_stats.splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            name = str(row.get("Name") or row.get("Container") or "")
            if name in containers:
                containers[name]["stats"] = {
                    "cpuPercent": _percent(row.get("CPUPerc")),
                    "memoryPercent": _percent(row.get("MemPerc")),
                    "memoryUsage": str(row.get("MemUsage") or ""),
                    "networkIO": str(row.get("NetIO") or ""),
                    "blockIO": str(row.get("BlockIO") or ""),
                    "pids": int(str(row.get("PIDs") or "0")),
                }
    return {"capturedAtUtc": utc_now(), "project": project_name, "containers": containers}


def _table_rows(report: dict[str, Any], table_name: str) -> int:
    for row in report.get("tables", []):
        if isinstance(row, dict) and row.get("tableName") == table_name:
            return int(row.get("estimatedRows") or 0)
    return 0


def _snapshot_items(report: dict[str, Any], storage_key: str) -> int:
    for row in report.get("snapshots", []):
        if isinstance(row, dict) and row.get("storageKey") == storage_key:
            return int(row.get("itemCount") or 0)
    return 0


def _changed_business_profile_keys(
    profile_before: dict[str, Any],
    profile_after: dict[str, Any],
) -> list[str]:
    before_by_key = profile_before.get("contentSha256ByKey")
    after_by_key = profile_after.get("contentSha256ByKey")
    if isinstance(before_by_key, dict) and isinstance(after_by_key, dict):
        return sorted(
            key
            for key in set(before_by_key) | set(after_by_key)
            if key not in RETENTION_MANAGED_PROFILE_KEYS
            and before_by_key.get(key) != after_by_key.get(key)
        )
    return ["unknown"] if profile_before.get("contentSha256") != profile_after.get("contentSha256") else []


def _retention_finished_at(capacity: dict[str, Any]) -> str:
    retention = capacity.get("retention") if isinstance(capacity.get("retention"), dict) else {}
    return str(retention.get("lastFinishedAt") or "")


def assess_expected_profile_counts(
    profile: dict[str, Any],
    expected_counts: dict[str, int],
    *,
    phase: str,
) -> list[str]:
    actual_counts = profile.get("counts") if isinstance(profile.get("counts"), dict) else {}
    failures: list[str] = []
    for key, expected in sorted(expected_counts.items()):
        actual = int(actual_counts.get(key, -1))
        if actual != expected:
            failures.append(f"{phase}业务规模不匹配: {key}={actual}, expected={expected}")
    return failures


def assess_expected_identity(
    profile: dict[str, Any],
    expected_identity_sha256: str,
    *,
    phase: str,
) -> list[str]:
    if not expected_identity_sha256:
        return []
    actual = str(profile.get("identitySha256") or "")
    if actual != expected_identity_sha256:
        return [f"{phase}业务身份签名不匹配: actual={actual or 'missing'}"]
    return []


def assess_retention_evidence(
    capacity_before: dict[str, Any],
    capacity_samples: list[dict[str, Any]],
    *,
    require_successful_run: bool,
    check_sample_health: bool = True,
) -> tuple[list[str], dict[str, Any]]:
    failures: list[str] = []
    before_retention = capacity_before.get("retention") if isinstance(capacity_before.get("retention"), dict) else {}
    before_finished = str(before_retention.get("lastFinishedAt") or "")
    previous_totals = {
        key: int((before_retention.get("totalDeleted") or {}).get(key, 0) or 0)
        for key in RETENTION_RESULT_KEYS
    }
    successful_runs: list[dict[str, Any]] = []
    observed_finished: list[str] = []
    for index, capacity in enumerate(capacity_samples, start=1):
        if check_sample_health and capacity.get("status") != "ok":
            failures.append(f"容量诊断采样异常: sample {index}")
        retention = capacity.get("retention") if isinstance(capacity.get("retention"), dict) else {}
        if check_sample_health and retention.get("enabled") is not True:
            failures.append(f"留存清理器采样未启用: sample {index}")
        if check_sample_health and not retention.get("scheduled") and not retention.get("running"):
            failures.append(f"留存清理器采样未运行或未调度: sample {index}")
        if check_sample_health and str(retention.get("lastError") or "").strip():
            failures.append(f"留存清理器采样存在错误: sample {index}")

        totals = retention.get("totalDeleted") if isinstance(retention.get("totalDeleted"), dict) else {}
        for key in RETENTION_RESULT_KEYS:
            current = int(totals.get(key, 0) or 0)
            if current < previous_totals[key]:
                failures.append(f"留存累计删除计数回退: {key}, sample {index}")
            previous_totals[key] = current

        finished = str(retention.get("lastFinishedAt") or "")
        if finished and finished != before_finished:
            observed_finished.append(finished)
            result = retention.get("lastResult") if isinstance(retention.get("lastResult"), dict) else {}
            deleted = result.get("deleted") if isinstance(result.get("deleted"), dict) else {}
            deleted_valid = all(
                key in deleted and isinstance(deleted[key], int) and not isinstance(deleted[key], bool) and deleted[key] >= 0
                for key in RETENTION_RESULT_KEYS
            )
            if result.get("acquired") is True and not str(result.get("skippedReason") or "").strip() and deleted_valid:
                successful_runs.append({"sample": index, "finishedAt": finished, "deleted": dict(deleted)})
    if require_successful_run and not successful_runs:
        failures.append("长稳窗口内未观察到获得数据库锁且结果完整的留存清理器成功运行")
    return failures, {
        "observedFinishedAt": list(dict.fromkeys(observed_finished)),
        "successfulRuns": successful_runs,
        "totalDeletedFinal": previous_totals,
    }


def assess_docker_samples(samples: list[dict[str, Any]], max_memory_percent: float) -> list[str]:
    failures: list[str] = []
    for sample_index, sample in enumerate(samples, start=1):
        for name, container in sample.get("containers", {}).items():
            service = container.get("service")
            if container.get("oomKilled"):
                failures.append(f"Docker容器发生OOM: {name}")
            if int(container.get("restartCount") or 0) > 0:
                failures.append(f"Docker容器发生重启: {name}")
            if container.get("dead"):
                failures.append(f"Docker容器进入dead状态: {name}")
            if service == "migrate":
                if container.get("running") or int(container.get("exitCode") or 0) != 0:
                    failures.append(f"迁移容器状态异常: {name}")
            else:
                if not container.get("running"):
                    failures.append(f"Stage4服务未运行: {name}")
                if container.get("health") and container.get("health") != "healthy":
                    failures.append(f"Stage4服务健康状态异常: {name}={container.get('health')}")
            log_config = container.get("logConfig") or {}
            options = log_config.get("Config") or {}
            if log_config.get("Type") != "json-file" or not options.get("max-size") or not options.get("max-file"):
                failures.append(f"Docker日志轮转未生效: {name}")
            memory_percent = float((container.get("stats") or {}).get("memoryPercent") or 0)
            if memory_percent >= max_memory_percent:
                failures.append(
                    f"Docker容器内存达到阈值: {name}={memory_percent:g}% (sample {sample_index})"
                )
    return list(dict.fromkeys(failures))


def aggregate_window_reports(
    windows: list[dict[str, Any]],
    *,
    p95_limit_ms: float,
    min_requests_per_endpoint: int,
    max_throughput_drop: float,
) -> dict[str, Any]:
    failures: list[str] = []
    endpoints: dict[str, dict[str, Any]] = {}
    total_requests = 0
    total_successful = 0
    total_errors = 0
    total_duration = 0.0
    low_throughput_windows = 0
    baseline_rps = 0.0
    for index, window in enumerate(windows, start=1):
        load = window["load"]
        duration = float(window["durationSeconds"])
        requests = int(load.get("overall", {}).get("requests") or 0)
        total_requests += requests
        total_successful += int(load.get("overall", {}).get("successful") or 0)
        total_errors += int(load.get("overall", {}).get("errors") or 0)
        total_duration += duration
        rps = requests / duration if duration > 0 else 0.0
        if index == 1:
            baseline_rps = rps
        elif baseline_rps > 0 and rps < baseline_rps * (1 - max_throughput_drop):
            low_throughput_windows += 1
        else:
            low_throughput_windows = 0
        if low_throughput_windows >= 2:
            failures.append("连续两个采样窗口吞吐较首窗口下降超过阈值")
        for failure in load.get("failures", []):
            failures.append(f"窗口{index}: {failure}")
        for endpoint, summary in load.get("endpoints", {}).items():
            aggregate = endpoints.setdefault(
                endpoint,
                {"requests": 0, "successful": 0, "errors": 0, "maxWindowP95Ms": 0.0, "maxMs": 0.0},
            )
            aggregate["requests"] += int(summary.get("requests") or 0)
            aggregate["successful"] += int(summary.get("successful") or 0)
            aggregate["errors"] += int(summary.get("errors") or 0)
            aggregate["maxWindowP95Ms"] = max(aggregate["maxWindowP95Ms"], float(summary.get("p95Ms") or 0))
            aggregate["maxMs"] = max(aggregate["maxMs"], float(summary.get("maxMs") or 0))
    if total_errors:
        failures.append(f"检测到 {total_errors} 个请求错误")
    for endpoint, summary in sorted(endpoints.items()):
        if summary["requests"] < min_requests_per_endpoint:
            failures.append(f"接口请求样本不足: {endpoint}={summary['requests']}<{min_requests_per_endpoint}")
        if summary["maxWindowP95Ms"] > p95_limit_ms:
            failures.append(f"窗口P95超过 {p95_limit_ms:g}ms: {endpoint}")
    missing = sorted({name for name, _path in DEFAULT_ENDPOINTS} - set(endpoints))
    if missing:
        failures.append(f"缺少接口样本: {', '.join(missing)}")
    return {
        "passed": not failures,
        "failures": list(dict.fromkeys(failures)),
        "overall": {
            "requests": total_requests,
            "successful": total_successful,
            "errors": total_errors,
            "errorRate": round(total_errors / total_requests, 6) if total_requests else 0.0,
            "requestsPerSecond": round(total_requests / total_duration, 3) if total_duration else 0.0,
            "durationSeconds": round(total_duration, 3),
        },
        "endpoints": dict(sorted(endpoints.items())),
        "windows": windows,
    }


def finalize_soak_report(
    load_report: dict[str, Any],
    *,
    profile_before: dict[str, Any],
    profile_after: dict[str, Any],
    capacity_before: dict[str, Any],
    capacity_after: dict[str, Any],
    max_event_row_growth: int,
    max_staging_event_growth: int,
    readiness_samples: list[dict[str, Any]] | None = None,
    docker_samples: list[dict[str, Any]] | None = None,
    max_memory_percent: float = 80.0,
    require_retention_run: bool = False,
    expected_profile_counts: dict[str, int] | None = None,
    expected_identity_sha256: str = "",
    capacity_samples: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    failures = list(load_report.get("failures", []))
    expected_counts = expected_profile_counts or {}
    failures.extend(assess_expected_profile_counts(profile_before, expected_counts, phase="开始时"))
    failures.extend(assess_expected_profile_counts(profile_after, expected_counts, phase="结束时"))
    failures.extend(assess_expected_identity(profile_before, expected_identity_sha256, phase="开始时"))
    failures.extend(assess_expected_identity(profile_after, expected_identity_sha256, phase="结束时"))
    changed_profile_keys = _changed_business_profile_keys(profile_before, profile_after)
    if changed_profile_keys:
        failures.append(f"只读长稳测试期间业务数据内容发生变化: {', '.join(changed_profile_keys)}")
    if capacity_after.get("status") != "ok":
        failures.append(f"容量诊断状态异常: {capacity_after.get('status') or 'unknown'}")
    retention = capacity_after.get("retention") if isinstance(capacity_after.get("retention"), dict) else {}
    if retention.get("enabled") is not True:
        failures.append("留存清理器未启用")
    if not retention.get("scheduled") and not retention.get("running"):
        failures.append("留存清理器未运行或未调度")
    if str(retention.get("lastError") or "").strip():
        failures.append("留存清理器最近一次运行失败")
    retention_failures, retention_evidence = assess_retention_evidence(
        capacity_before,
        capacity_samples or [capacity_after],
        require_successful_run=require_retention_run,
        check_sample_health=capacity_samples is not None,
    )
    failures.extend(retention_failures)
    for index, sample in enumerate(readiness_samples or [], start=1):
        if sample.get("status") != "ready":
            failures.append(f"readiness采样异常: sample {index}")

    growth = {
        "mqMessageRows": _table_rows(capacity_after, "biz_mq_message_log") - _table_rows(capacity_before, "biz_mq_message_log"),
        "experimentEventRows": _table_rows(capacity_after, "biz_experiment_event") - _table_rows(capacity_before, "biz_experiment_event"),
        "stagingEventItems": _snapshot_items(capacity_after, "mes.staging_events") - _snapshot_items(capacity_before, "mes.staging_events"),
    }
    if growth["mqMessageRows"] > max_event_row_growth:
        failures.append("MQTT 消息表在长稳窗口内增长超过阈值")
    if growth["experimentEventRows"] > max_event_row_growth:
        failures.append("实验事件表在长稳窗口内增长超过阈值")
    if growth["stagingEventItems"] > max_staging_event_growth:
        failures.append("暂存事件快照在只读长稳窗口内异常增长")
    failures.extend(assess_docker_samples(docker_samples or [], max_memory_percent))
    failures = list(dict.fromkeys(failures))

    return {
        **load_report,
        "complete": True,
        "passed": not failures,
        "failures": failures,
        "soak": {
            "profileBefore": profile_before,
            "profileAfter": profile_after,
            "changedBusinessProfileKeys": changed_profile_keys,
            "capacityBefore": capacity_before,
            "capacityAfter": capacity_after,
            "readinessSamples": readiness_samples or [],
            "dockerSamples": docker_samples or [],
            "growth": growth,
            "retentionEvidence": retention_evidence,
            "limits": {
                "maxEventRowGrowth": max_event_row_growth,
                "maxStagingEventGrowth": max_staging_event_growth,
                "maxMemoryPercent": max_memory_percent,
                "requireRetentionRun": require_retention_run,
                "expectedProfileCounts": expected_counts,
                "expectedIdentitySha256": expected_identity_sha256,
            },
        },
    }


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")
    temporary.replace(path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="MES 阶段四：分段长期运行只读验收")
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--users", type=int, default=5)
    parser.add_argument("--duration", type=float, default=600.0)
    parser.add_argument("--window-seconds", type=float, default=60.0)
    parser.add_argument("--think-time", type=float, default=0.2)
    parser.add_argument("--timeout", type=float, default=5.0)
    parser.add_argument("--p95-limit-ms", type=float, default=500.0)
    parser.add_argument("--min-requests-per-endpoint", type=int, default=100)
    parser.add_argument("--max-throughput-drop", type=float, default=0.3)
    parser.add_argument("--max-event-row-growth", type=int, default=1000)
    parser.add_argument("--max-staging-event-growth", type=int, default=0)
    parser.add_argument("--docker-project", default="")
    parser.add_argument("--max-memory-percent", type=float, default=80.0)
    parser.add_argument("--require-retention-run", action="store_true")
    parser.add_argument("--expected-task-count", type=int, default=0)
    parser.add_argument("--expected-sample-count", type=int, default=0)
    parser.add_argument("--expected-experiment-count", type=int, default=0)
    parser.add_argument("--expected-experiment-sample-count", type=int, default=0)
    parser.add_argument("--expected-identity-sha256", default="")
    parser.add_argument("--output", default="artifacts/performance/stage4-soak-report.json")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if (
        args.users < 1
        or args.duration <= 0
        or args.window_seconds <= 0
        or args.timeout <= 0
        or args.think_time < 0
        or args.min_requests_per_endpoint < 1
        or not 0 <= args.max_throughput_drop < 1
        or not 0 < args.max_memory_percent <= 100
        or min(
            args.expected_task_count,
            args.expected_sample_count,
            args.expected_experiment_count,
            args.expected_experiment_sample_count,
        ) < 0
        or (args.expected_identity_sha256 and len(args.expected_identity_sha256) != 64)
    ):
        raise SystemExit("Stage4参数超出安全范围")
    output_path = Path(args.output)
    windows: list[dict[str, Any]] = []
    readiness_samples: list[dict[str, Any]] = []
    capacity_samples: list[dict[str, Any]] = []
    docker_samples: list[dict[str, Any]] = []
    error_examples: list[dict[str, Any]] = []
    started_at = utc_now()
    try:
        profile_before = capture_data_profile(args.base_url, args.timeout)
        capacity_before = capture_capacity(args.base_url, args.timeout)
        readiness_samples.append(capture_readiness(args.base_url, args.timeout))
        if args.docker_project:
            docker_samples.append(capture_docker_sample(args.docker_project))
        deadline = time.monotonic() + args.duration
        while (remaining := deadline - time.monotonic()) > 0:
            window_duration = min(args.window_seconds, remaining)
            window_started_at = utc_now()
            load_report, samples = run_probe(
                base_url=args.base_url,
                duration_seconds=window_duration,
                users=args.users,
                think_time_seconds=args.think_time,
                timeout_seconds=args.timeout,
                p95_limit_ms=args.p95_limit_ms,
            )
            error_examples.extend(asdict(sample) for sample in samples if not sample.ok)
            del samples
            readiness = capture_readiness(args.base_url, args.timeout)
            capacity = capture_capacity(args.base_url, args.timeout)
            docker_sample = capture_docker_sample(args.docker_project) if args.docker_project else {}
            readiness_samples.append(readiness)
            capacity_samples.append(capacity)
            if docker_sample:
                docker_samples.append(docker_sample)
            windows.append(
                {
                    "startedAtUtc": window_started_at,
                    "durationSeconds": round(window_duration, 3),
                    "load": load_report,
                    "readiness": readiness,
                    "capacity": capacity,
                    "docker": docker_sample,
                }
            )
            checkpoint = aggregate_window_reports(
                windows,
                p95_limit_ms=args.p95_limit_ms,
                min_requests_per_endpoint=args.min_requests_per_endpoint,
                max_throughput_drop=args.max_throughput_drop,
            )
            checkpoint.update({"complete": False, "startedAtUtc": started_at, "updatedAtUtc": utc_now()})
            write_report(output_path, checkpoint)

        load_report = aggregate_window_reports(
            windows,
            p95_limit_ms=args.p95_limit_ms,
            min_requests_per_endpoint=args.min_requests_per_endpoint,
            max_throughput_drop=args.max_throughput_drop,
        )
        report = finalize_soak_report(
            load_report,
            profile_before=profile_before,
            profile_after=capture_data_profile(args.base_url, args.timeout),
            capacity_before=capacity_before,
            capacity_after=capacity_samples[-1] if capacity_samples else capture_capacity(args.base_url, args.timeout),
            max_event_row_growth=max(0, args.max_event_row_growth),
            max_staging_event_growth=max(0, args.max_staging_event_growth),
            readiness_samples=readiness_samples,
            docker_samples=docker_samples,
            max_memory_percent=args.max_memory_percent,
            require_retention_run=args.require_retention_run,
            capacity_samples=capacity_samples,
            expected_profile_counts={
                key: count
                for key, count in {
                    "mes.tasks": args.expected_task_count,
                    "mes.samples": args.expected_sample_count,
                    "mes.experiments": args.expected_experiment_count,
                    "mes.experiment_samples": args.expected_experiment_sample_count,
                }.items()
                if count > 0
            },
            expected_identity_sha256=args.expected_identity_sha256,
        )
        report.update({"startedAtUtc": started_at, "finishedAtUtc": utc_now(), "errorExamples": error_examples[:10]})
        write_report(output_path, report)
        print(json.dumps({"passed": report["passed"], "output": str(output_path), "failures": report["failures"]}, ensure_ascii=False))
        return 0 if report["passed"] else 1
    except Exception as error:
        report = {
            "complete": False,
            "passed": False,
            "startedAtUtc": started_at,
            "finishedAtUtc": utc_now(),
            "failures": [f"Stage4探针异常中止: {error}"],
            "windows": windows,
            "readinessSamples": readiness_samples,
            "capacitySamples": capacity_samples,
            "dockerSamples": docker_samples,
        }
        write_report(output_path, report)
        print(json.dumps({"passed": False, "output": str(output_path), "failures": report["failures"]}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
