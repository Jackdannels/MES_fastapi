"""Bind this Windows user's installed clients with the local MES admin configuration."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def enroll_directory(directory: Path) -> int:
    sys.path.insert(0, str(ROOT))
    from app.core.config import settings

    if not settings.DEMO_USER or not settings.DEMO_PASSWORD:
        raise RuntimeError("Local MES administrator configuration is missing.")
    manifest = json.loads((directory / "workstations-manifest.json").read_text(encoding="utf-8-sig"))
    credentials = json.dumps({"username": settings.DEMO_USER, "password": settings.DEMO_PASSWORD})
    count = 0
    for station in manifest["workstations"]:
        folder = (directory / station["folder"]).resolve()
        if not folder.is_relative_to(directory.resolve()):
            raise ValueError("Workstation folder escapes the installation directory.")
        exe = (folder / station["executable"]).resolve()
        if not exe.is_relative_to(folder):
            raise ValueError("Executable escapes the workstation directory.")
        # Secrets travel only over stdin to this local child, then the configured MES server.
        result = subprocess.run([str(exe), "--enroll-terminal"], input=credentials,
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30, cwd=folder)
        if result.returncode:
            raise RuntimeError(f"Enrollment failed for {station['folder']}: {result.stderr.strip()}")
        count += 1
        print(f"Bound workstation: {station['folder']}", flush=True)
    return count


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    print(f"Enrolled {enroll_directory(args.directory)} workstations for the current Windows user.")
