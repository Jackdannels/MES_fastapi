from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any
import urllib.request


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.stage3a_load_probe import capture_data_profile, run_probe


RETENTION_MANAGED_PROFILE_KEYS = {"mes.staging_events"}


def capture_capacity(base_url: str, timeout_seconds: float) -> dict[str, Any]:
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/health/capacity",
        headers={"Accept": "application/json", "User-Agent": "MES-Stage4-Soak/1.0"},
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError("capacity endpoint did not return an object")
    return payload


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


def finalize_soak_report(
    load_report: dict[str, Any],
    *,
    profile_before: dict[str, Any],
    profile_after: dict[str, Any],
    capacity_before: dict[str, Any],
    capacity_after: dict[str, Any],
    max_event_row_growth: int,
    max_staging_event_growth: int,
) -> dict[str, Any]:
    failures = list(load_report.get("failures", []))
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

    return {
        **load_report,
        "passed": not failures,
        "failures": failures,
        "soak": {
            "profileBefore": profile_before,
            "profileAfter": profile_after,
            "changedBusinessProfileKeys": changed_profile_keys,
            "capacityBefore": capacity_before,
            "capacityAfter": capacity_after,
            "growth": growth,
            "limits": {
                "maxEventRowGrowth": max_event_row_growth,
                "maxStagingEventGrowth": max_staging_event_growth,
            },
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="MES 阶段四：长期运行只读验收")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--users", type=int, default=5)
    parser.add_argument("--duration", type=float, default=600.0)
    parser.add_argument("--think-time", type=float, default=0.2)
    parser.add_argument("--timeout", type=float, default=5.0)
    parser.add_argument("--p95-limit-ms", type=float, default=500.0)
    parser.add_argument("--max-event-row-growth", type=int, default=1000)
    parser.add_argument("--max-staging-event-growth", type=int, default=0)
    parser.add_argument("--output", default="artifacts/performance/stage4-soak-report.json")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.users < 1 or args.duration <= 0 or args.timeout <= 0 or args.think_time < 0:
        raise SystemExit("users/duration/timeout 必须为正数，think-time 不能为负数")
    profile_before = capture_data_profile(args.base_url, args.timeout)
    capacity_before = capture_capacity(args.base_url, args.timeout)
    load_report, _samples = run_probe(
        base_url=args.base_url,
        duration_seconds=args.duration,
        users=args.users,
        think_time_seconds=args.think_time,
        timeout_seconds=args.timeout,
        p95_limit_ms=args.p95_limit_ms,
        data_profile=profile_before,
    )
    report = finalize_soak_report(
        load_report,
        profile_before=profile_before,
        profile_after=capture_data_profile(args.base_url, args.timeout),
        capacity_before=capacity_before,
        capacity_after=capture_capacity(args.base_url, args.timeout),
        max_event_row_growth=max(0, args.max_event_row_growth),
        max_staging_event_growth=max(0, args.max_staging_event_growth),
    )
    rendered = json.dumps(report, ensure_ascii=False, indent=2, default=str)
    print(rendered)
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(f"{rendered}\n", encoding="utf-8")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
