from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.core.demo_data_reset import run_demo_reset
from scripts.init_mysql_storage import create_mysql_storage_backend, initialize_mysql_storage


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Reset MySQL demo data without using JSON as the runtime source.")
    parser.parse_args(argv)

    initialize_mysql_storage(seed_demo=False)
    summary = run_demo_reset(create_mysql_storage_backend())
    print(
        f"Demo data reset complete: tasks={summary['task_count']}, "
        f"samples={summary['sample_count']}, experiments={summary['experiment_count']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
