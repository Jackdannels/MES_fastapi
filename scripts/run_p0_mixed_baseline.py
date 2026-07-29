from __future__ import annotations

import argparse
import json
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.generate_p0_capacity_fixture import (
    CONFIRMATION_TEXT,
    SAMPLE_COUNT,
    TASK_COUNT,
    validate_capacity_database,
)
from scripts.stage3a_load_probe import (
    DEFAULT_ENDPOINTS,
    RequestSample,
    build_report,
    capture_data_profile,
    execute_request,
    parse_server_timing,
)


def read_runtime_database(base_url: str, timeout_seconds: float) -> str:
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/health",
        headers={"Accept": "application/json", "User-Agent": "MES-P0-Mixed-Probe/1.0"},
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return str(payload.get("storage", {}).get("mysql", {}).get("database", ""))


def execute_stream_write(base_url: str, timeout_seconds: float, sequence: int) -> RequestSample:
    payload = json.dumps([{
        "id": "P0-BASELINE-STREAM",
        "task_code": "P0-TASK-001",
        "device": "P0-DEVICE-01",
        "last_packet": "2026-01-05T08:00:00+08:00",
        "quality": 1.0,
        "status": "正常" if sequence % 2 == 0 else "基线写入",
        "reported": bool(sequence % 2),
    }], ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/storage/mes.streams",
        data=payload,
        method="PUT",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "MES-P0-Mixed-Probe/1.0",
        },
    )
    started_at = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            response_payload = response.read()
            status = int(response.status)
            return RequestSample(
                endpoint="stream_write",
                elapsed_ms=(time.perf_counter() - started_at) * 1000,
                ok=200 <= status < 400,
                response_bytes=len(response_payload),
                status=status,
                request_id=response.headers.get("X-Request-ID", ""),
                db_query_count=int(response.headers.get("X-MES-DB-Queries", "0") or 0),
                server_timings_ms=parse_server_timing(response.headers.get("Server-Timing", "")),
            )
    except Exception as error:
        return RequestSample(
            endpoint="stream_write",
            elapsed_ms=(time.perf_counter() - started_at) * 1000,
            ok=False,
            response_bytes=0,
            status=0,
            error=str(error),
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="在隔离容量数据库运行5用户读写混合基线")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--duration", type=float, default=60.0)
    parser.add_argument("--timeout", type=float, default=5.0)
    parser.add_argument("--think-time", type=float, default=0.2)
    parser.add_argument("--write-interval", type=float, default=1.0)
    parser.add_argument("--read-p95-limit-ms", type=float, default=500.0)
    parser.add_argument("--write-p95-limit-ms", type=float, default=1000.0)
    parser.add_argument("--confirm-isolated-write", default="")
    parser.add_argument("--output", default="artifacts/performance/p0-mixed-5-users.json")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.confirm_isolated_write != CONFIRMATION_TEXT:
        raise SystemExit(f"混合基线会写数据，必须传入 --confirm-isolated-write {CONFIRMATION_TEXT}")
    database = read_runtime_database(args.base_url, args.timeout)
    validate_capacity_database(database)
    started_profile = capture_data_profile(args.base_url, args.timeout)
    counts = started_profile["counts"]
    if counts.get("mes.tasks") != TASK_COUNT or counts.get("mes.samples") != SAMPLE_COUNT:
        raise SystemExit("目标服务未加载P0固定容量数据，拒绝执行写入基线")

    users = 5
    samples: list[RequestSample] = []
    samples_lock = threading.Lock()
    barrier = threading.Barrier(users)
    deadline = time.perf_counter() + args.duration

    def reader(user_index: int) -> None:
        request_index = user_index
        barrier.wait()
        while time.perf_counter() < deadline:
            sample = execute_request(
                args.base_url,
                DEFAULT_ENDPOINTS[request_index % len(DEFAULT_ENDPOINTS)],
                args.timeout,
            )
            with samples_lock:
                samples.append(sample)
            request_index += 1
            time.sleep(args.think_time)

    def writer() -> None:
        sequence = 0
        barrier.wait()
        while time.perf_counter() < deadline:
            sample = execute_stream_write(args.base_url, args.timeout, sequence)
            with samples_lock:
                samples.append(sample)
            sequence += 1
            time.sleep(args.write_interval)

    with ThreadPoolExecutor(max_workers=users, thread_name_prefix="mes-p0-mixed-user") as executor:
        futures = [executor.submit(reader, index) for index in range(users - 1)]
        futures.append(executor.submit(writer))
        for future in futures:
            future.result()

    # Restore the deterministic fixture value so repeated mixed runs remain comparable.
    samples.append(execute_stream_write(args.base_url, args.timeout, 0))

    report = build_report(
        samples,
        base_url=args.base_url,
        duration_seconds=args.duration,
        users=users,
        p95_limit_ms=1_000_000_000.0,
        data_profile=started_profile,
    )
    failures = list(report["failures"])
    slow_reads = [
        name for name, summary in report["endpoints"].items()
        if name != "stream_write" and summary["p95Ms"] > args.read_p95_limit_ms
    ]
    write_summary = report["endpoints"].get("stream_write", {})
    if slow_reads:
        failures.append(f"读取P95超过{args.read_p95_limit_ms:g}ms: {', '.join(slow_reads)}")
    if write_summary.get("p95Ms", 0) > args.write_p95_limit_ms:
        failures.append(f"写入P95超过{args.write_p95_limit_ms:g}ms")
    finished_profile = capture_data_profile(args.base_url, args.timeout)
    if started_profile["contentSha256"] != finished_profile["contentSha256"]:
        failures.append("混合基线未能恢复固定数据内容")
    report.update({
        "passed": not failures,
        "failures": failures,
        "database": database,
        "finishedDataProfile": finished_profile,
    })
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
