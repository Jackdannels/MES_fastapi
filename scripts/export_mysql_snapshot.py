from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.core.storage_backend import DEFAULT_STORE_PATH, normalize_storage_payload
from scripts.init_mysql_storage import create_mysql_storage_backend


def export_mysql_snapshot(output_path: Path | None = None) -> dict[str, object]:
    destination = Path(output_path or DEFAULT_STORE_PATH)
    destination.parent.mkdir(parents=True, exist_ok=True)

    snapshot = normalize_storage_payload(create_mysql_storage_backend().read_all())
    destination.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "output_path": str(destination),
        "task_count": len(snapshot.get("mes.tasks", [])),
        "sample_count": len(snapshot.get("mes.samples", [])),
        "experiment_count": len(snapshot.get("mes.experiments", [])),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Explicitly export the current MySQL MES snapshot to JSON.")
    parser.add_argument(
        "--output",
        default=str(DEFAULT_STORE_PATH),
        help="Destination path for the exported JSON snapshot.",
    )
    args = parser.parse_args(argv)

    summary = export_mysql_snapshot(Path(args.output))
    print(
        f"MySQL snapshot exported: output={summary['output_path']}, tasks={summary['task_count']}, "
        f"samples={summary['sample_count']}, experiments={summary['experiment_count']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
