from __future__ import annotations

import argparse
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.db.session import get_connection


def clear_test_data_history() -> int:
    """Delete legacy data-stream rows without touching workflow history."""

    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM biz_data_stream")
            deleted_count = int(cursor.rowcount or 0)
        connection.commit()
    return deleted_count


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Delete legacy trial data-stream history from biz_data_stream.",
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Confirm the irreversible deletion of all biz_data_stream rows.",
    )
    args = parser.parse_args(argv)
    if not args.confirm:
        parser.error("--confirm is required")

    deleted_count = clear_test_data_history()
    print(f"Trial data history cleared: deleted_rows={deleted_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
