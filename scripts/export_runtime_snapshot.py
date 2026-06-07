from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from app.core.storage_backend import get_storage_backend, normalize_storage_payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Export the current runtime MES storage snapshot as JSON.")
    parser.add_argument("--output", "-o", help="Path to write the snapshot JSON. Defaults to stdout.")
    args = parser.parse_args()

    snapshot = normalize_storage_payload(get_storage_backend().read_all())
    text = json.dumps(snapshot, ensure_ascii=False, indent=2)

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(text, encoding="utf-8")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
