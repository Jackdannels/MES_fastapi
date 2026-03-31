from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.core.demo_data_reset import run_demo_reset
from app.core.storage_backend import get_storage_backend


def main() -> int:
    summary = run_demo_reset(get_storage_backend())
    print(
        f"Demo data reset complete: tasks={summary['task_count']}, "
        f"samples={summary['sample_count']}, experiments={summary['experiment_count']}, "
        f"store={summary['store_path']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
