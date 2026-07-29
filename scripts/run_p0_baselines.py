from __future__ import annotations

import argparse
import json
import statistics
import sys
import urllib.request
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.generate_p0_capacity_fixture import build_capacity_snapshot
from scripts.stage3a_load_probe import (
    DEFAULT_ENDPOINTS,
    build_data_profile,
    capture_data_profile,
    execute_request,
    run_probe,
)


SCENARIO_LIMITS = {
    5: {
        "overallP95Ms": 300.0,
        "defaultEndpointP95Ms": 500.0,
        "endpointP95Ms": {"health": 100.0, "mqtt_status": 100.0, "samples": 400.0},
    },
    10: {
        "overallP95Ms": 500.0,
        "defaultEndpointP95Ms": 500.0,
        "endpointP95Ms": {"health": 150.0, "mqtt_status": 150.0, "samples": 600.0},
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="运行隔离 MES P0 的5/10用户正式只读容量基线")
    parser.add_argument("--base-url", default="http://127.0.0.1:18000")
    parser.add_argument("--expected-host", default="127.0.0.1")
    parser.add_argument("--expected-port", type=int, default=3337)
    parser.add_argument("--expected-database", default="mes_p0_capacity")
    parser.add_argument("--duration", type=float, default=60.0)
    parser.add_argument("--think-time", type=float, default=0.2)
    parser.add_argument("--timeout", type=float, default=5.0)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--output-dir", default="artifacts/performance/p0-formal")
    parser.add_argument("--quiet", action="store_true", help="控制台只输出通过状态和中位数，完整报告仍写入文件")
    return parser.parse_args()


def read_runtime_target(base_url: str, timeout_seconds: float) -> dict[str, Any]:
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/health",
        headers={"Accept": "application/json", "User-Agent": "MES-P0-Baseline/2.0"},
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        payload = json.loads(response.read().decode("utf-8"))
    mysql = payload.get("storage", {}).get("mysql", {})
    return {
        "host": str(mysql.get("host", "")),
        "port": int(mysql.get("port", 0) or 0),
        "database": str(mysql.get("database", "")),
    }


def validate_runtime_target(
    target: dict[str, Any],
    *,
    expected_host: str,
    expected_port: int,
    expected_database: str,
) -> None:
    actual = (target.get("host", "").lower(), int(target.get("port", 0)), target.get("database", ""))
    expected = (expected_host.strip().lower(), int(expected_port), expected_database.strip())
    if actual != expected:
        raise RuntimeError(f"P0服务数据库目标不匹配：actual={actual}, expected={expected}")


def expected_fixture_profile() -> dict[str, Any]:
    return build_data_profile(build_capacity_snapshot())


def validate_fixture_profile(actual: dict[str, Any], expected: dict[str, Any]) -> None:
    expected_counts = expected["counts"]
    mismatches = {
        key: {"actual": actual["counts"].get(key), "expected": expected_count}
        for key, expected_count in expected_counts.items()
        if actual["counts"].get(key) != expected_count
    }
    if mismatches:
        raise RuntimeError(f"P0固定容量计数不匹配：{mismatches}")
    if actual.get("identitySha256") != expected.get("identitySha256"):
        raise RuntimeError("P0固定容量身份签名不匹配")


def warm_up(base_url: str, timeout_seconds: float) -> None:
    failures = []
    for endpoint in DEFAULT_ENDPOINTS:
        sample = execute_request(base_url, endpoint, timeout_seconds)
        if not sample.ok:
            failures.append(f"{sample.endpoint}:{sample.status}:{sample.error}")
    if failures:
        raise RuntimeError(f"P0预热失败：{failures}")


def evaluate_report(report: dict[str, Any], users: int) -> list[str]:
    limits = SCENARIO_LIMITS[users]
    failures = list(report.get("failures", []))
    overall_p95 = float(report["overall"].get("p95Ms", 0))
    if overall_p95 > limits["overallP95Ms"]:
        failures.append(f"总体P95超过{limits['overallP95Ms']:g}ms")
    for endpoint, summary in report["endpoints"].items():
        endpoint_limit = limits["endpointP95Ms"].get(endpoint, limits["defaultEndpointP95Ms"])
        if float(summary.get("p95Ms", 0)) > endpoint_limit:
            failures.append(f"{endpoint} P95超过{endpoint_limit:g}ms")
    return list(dict.fromkeys(failures))


def median_summary(reports: list[dict[str, Any]]) -> dict[str, Any]:
    endpoint_names = sorted({name for report in reports for name in report["endpoints"]})
    return {
        "runs": len(reports),
        "overall": {
            key: round(statistics.median(float(report["overall"].get(key, 0)) for report in reports), 2)
            for key in ("p50Ms", "p95Ms", "p99Ms", "maxMs", "averageResponseBytes")
        },
        "endpoints": {
            endpoint: {
                key: round(statistics.median(float(report["endpoints"][endpoint].get(key, 0)) for report in reports), 2)
                for key in ("p50Ms", "p95Ms", "p99Ms", "maxMs", "averageResponseBytes")
            }
            for endpoint in endpoint_names
        },
    }


def main() -> int:
    args = parse_args()
    if args.duration <= 0 or args.think_time < 0 or args.timeout <= 0 or args.repeats < 1:
        raise SystemExit("duration/timeout/repeats必须为正数，think-time不能为负数")

    target = read_runtime_target(args.base_url, args.timeout)
    validate_runtime_target(
        target,
        expected_host=args.expected_host,
        expected_port=args.expected_port,
        expected_database=args.expected_database,
    )
    expected_profile = expected_fixture_profile()
    initial_profile = capture_data_profile(args.base_url, args.timeout)
    validate_fixture_profile(initial_profile, expected_profile)
    warm_up(args.base_url, args.timeout)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    scenario_reports: dict[str, list[dict[str, Any]]] = {}
    all_passed = True
    for users in (5, 10):
        reports = []
        for run_number in range(1, args.repeats + 1):
            started_profile = capture_data_profile(args.base_url, args.timeout)
            validate_fixture_profile(started_profile, expected_profile)
            report, samples = run_probe(
                base_url=args.base_url,
                duration_seconds=args.duration,
                users=users,
                think_time_seconds=args.think_time,
                timeout_seconds=args.timeout,
                p95_limit_ms=1_000_000_000.0,
                data_profile=started_profile,
            )
            finished_profile = capture_data_profile(args.base_url, args.timeout)
            data_stable = started_profile["contentSha256"] == finished_profile["contentSha256"]
            failures = evaluate_report(report, users)
            if not data_stable:
                failures.append("运行期间固定容量数据发生变化")
            report.update({
                "passed": not failures,
                "failures": failures,
                "runNumber": run_number,
                "dataStable": data_stable,
                "finishedDataProfile": finished_profile,
            })
            error_examples = [asdict(sample) for sample in samples if not sample.ok][:10]
            if error_examples:
                report["errorExamples"] = error_examples
            reports.append(report)
            all_passed = all_passed and report["passed"]
            (output_dir / f"p0-read-{users}-users-run-{run_number}.json").write_text(
                json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        scenario_reports[f"users{users}"] = reports

    summary = {
        "passed": all_passed,
        "capturedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "runtimeTarget": target,
        "expectedFixtureProfile": expected_profile,
        "scenarios": {
            name: {
                "passed": all(report["passed"] for report in reports),
                "median": median_summary(reports),
                "runs": reports,
            }
            for name, reports in scenario_reports.items()
        },
    }
    (output_dir / "p0-baseline-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    console_summary = summary if not args.quiet else {
        "passed": summary["passed"],
        "capturedAt": summary["capturedAt"],
        "runtimeTarget": target,
        "scenarioMedians": {
            name: scenario["median"]
            for name, scenario in summary["scenarios"].items()
        },
    }
    print(json.dumps(console_summary, ensure_ascii=False, indent=2))
    return 0 if all_passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
