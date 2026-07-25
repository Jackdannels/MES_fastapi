from __future__ import annotations

import argparse
import json
import math
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


DEFAULT_ENDPOINTS = (
    ("health", "/health"),
    (
        "dashboard",
        "/api/storage?keys=mes.conflicts%2Cmes.devices%2Cmes.experiments%2Cmes.samples%2Cmes.schedules%2Cmes.streams%2Cmes.tasks",
    ),
    (
        "samples",
        "/api/storage?keys=mes.experiment_run_steps%2Cmes.experiment_run_trays%2Cmes.experiment_runs%2Cmes.experiment_samples%2Cmes.experiment_trays%2Cmes.experiments%2Cmes.samples%2Cmes.schedules%2Cmes.staging_events%2Cmes.streams%2Cmes.tasks",
    ),
    ("transfer_bootstrap", "/api/transfer-area/bootstrap"),
    (
        "visualization",
        "/api/storage?keys=mes.devices%2Cmes.experiment_run_steps%2Cmes.experiment_run_trays%2Cmes.experiment_runs%2Cmes.experiment_trays%2Cmes.experiments%2Cmes.samples%2Cmes.schedules%2Cmes.staging_events%2Cmes.tasks",
    ),
    ("mqtt_status", "/api/mq/interface-mode"),
)


@dataclass(frozen=True)
class RequestSample:
    endpoint: str
    elapsed_ms: float
    ok: bool
    response_bytes: int
    status: int
    error: str = ""


def percentile(values: list[float], percentage: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(len(ordered) * percentage / 100) - 1))
    return ordered[index]


def summarize_samples(samples: list[RequestSample]) -> dict[str, Any]:
    elapsed_values = [sample.elapsed_ms for sample in samples]
    successful = [sample for sample in samples if sample.ok]
    return {
        "requests": len(samples),
        "successful": len(successful),
        "errors": len(samples) - len(successful),
        "errorRate": round((len(samples) - len(successful)) / len(samples), 6) if samples else 0.0,
        "responseBytes": sum(sample.response_bytes for sample in samples),
        "p50Ms": round(percentile(elapsed_values, 50), 2),
        "p95Ms": round(percentile(elapsed_values, 95), 2),
        "p99Ms": round(percentile(elapsed_values, 99), 2),
        "maxMs": round(max(elapsed_values, default=0.0), 2),
    }


def build_report(
    samples: list[RequestSample],
    *,
    base_url: str,
    duration_seconds: float,
    users: int,
    p95_limit_ms: float,
) -> dict[str, Any]:
    grouped: dict[str, list[RequestSample]] = defaultdict(list)
    for sample in samples:
        grouped[sample.endpoint].append(sample)
    endpoint_summaries = {
        endpoint: summarize_samples(endpoint_samples)
        for endpoint, endpoint_samples in sorted(grouped.items())
    }
    overall = summarize_samples(samples)
    failures = []
    if overall["errors"]:
        failures.append(f"检测到 {overall['errors']} 个请求错误")
    slow_endpoints = [
        endpoint
        for endpoint, summary in endpoint_summaries.items()
        if summary["p95Ms"] > p95_limit_ms
    ]
    if slow_endpoints:
        failures.append(f"P95 超过 {p95_limit_ms:g}ms: {', '.join(slow_endpoints)}")
    return {
        "passed": not failures,
        "failures": failures,
        "config": {
            "baseUrl": base_url,
            "durationSeconds": duration_seconds,
            "users": users,
            "p95LimitMs": p95_limit_ms,
        },
        "overall": overall,
        "endpoints": endpoint_summaries,
    }


def execute_request(base_url: str, endpoint: tuple[str, str], timeout_seconds: float) -> RequestSample:
    endpoint_name, path = endpoint
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}{path}",
        headers={"Accept": "application/json", "User-Agent": "MES-Stage3A-Probe/1.0"},
    )
    started_at = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            payload = response.read()
            status = int(response.status)
        return RequestSample(
            endpoint=endpoint_name,
            elapsed_ms=(time.perf_counter() - started_at) * 1000,
            ok=200 <= status < 400,
            response_bytes=len(payload),
            status=status,
        )
    except urllib.error.HTTPError as error:
        return RequestSample(
            endpoint=endpoint_name,
            elapsed_ms=(time.perf_counter() - started_at) * 1000,
            ok=False,
            response_bytes=0,
            status=int(error.code),
            error=str(error),
        )
    except Exception as error:  # pragma: no cover - exercised by live probe failures
        return RequestSample(
            endpoint=endpoint_name,
            elapsed_ms=(time.perf_counter() - started_at) * 1000,
            ok=False,
            response_bytes=0,
            status=0,
            error=str(error),
        )


def run_probe(
    *,
    base_url: str,
    duration_seconds: float,
    users: int,
    think_time_seconds: float,
    timeout_seconds: float,
    p95_limit_ms: float,
) -> tuple[dict[str, Any], list[RequestSample]]:
    samples: list[RequestSample] = []
    samples_lock = threading.Lock()
    start_barrier = threading.Barrier(users)
    deadline = time.perf_counter() + duration_seconds

    def run_user(user_index: int) -> None:
        start_barrier.wait()
        request_index = user_index
        while time.perf_counter() < deadline:
            sample = execute_request(
                base_url,
                DEFAULT_ENDPOINTS[request_index % len(DEFAULT_ENDPOINTS)],
                timeout_seconds,
            )
            with samples_lock:
                samples.append(sample)
            request_index += 1
            if think_time_seconds > 0:
                time.sleep(think_time_seconds)

    with ThreadPoolExecutor(max_workers=users, thread_name_prefix="mes-stage3a-user") as executor:
        futures = [executor.submit(run_user, user_index) for user_index in range(users)]
        for future in futures:
            future.result()

    return build_report(
        samples,
        base_url=base_url,
        duration_seconds=duration_seconds,
        users=users,
        p95_limit_ms=p95_limit_ms,
    ), samples


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="MES 第三阶段 A：低风险并发容量探测")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--users", type=int, default=5)
    parser.add_argument("--duration", type=float, default=60.0, help="探测时长（秒）")
    parser.add_argument("--think-time", type=float, default=0.2, help="每个虚拟用户请求间隔（秒）")
    parser.add_argument("--timeout", type=float, default=5.0, help="单请求超时（秒）")
    parser.add_argument("--p95-limit-ms", type=float, default=500.0)
    parser.add_argument("--output", default="", help="可选 JSON 报告路径")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.users < 1 or args.duration <= 0 or args.think_time < 0 or args.timeout <= 0:
        raise SystemExit("users/duration/timeout 必须为正数，think-time 不能为负数")
    report, samples = run_probe(
        base_url=args.base_url,
        duration_seconds=args.duration,
        users=args.users,
        think_time_seconds=args.think_time,
        timeout_seconds=args.timeout,
        p95_limit_ms=args.p95_limit_ms,
    )
    error_examples = [asdict(sample) for sample in samples if not sample.ok][:10]
    if error_examples:
        report["errorExamples"] = error_examples
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    print(rendered)
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(f"{rendered}\n", encoding="utf-8")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
