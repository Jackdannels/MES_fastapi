"""Refresh native payload source files and their deterministic file inventory."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]


def finalize(output):
    output = Path(output).resolve()
    payload = output / "payload"
    for source in (ROOT / "deploy/native").iterdir():
        if source.is_file():
            shutil.copy2(source, payload / "native" / source.name)
    shutil.copy2(ROOT / "app/services/test_data_reports.py", payload / "app/services/test_data_reports.py")
    shutil.copytree(ROOT / "frontend/dist", payload / "frontend/dist", dirs_exist_ok=True)
    (output / "docs").mkdir(exist_ok=True)
    shutil.copy2(ROOT / "docs/native-offline-deployment.md", output / "docs/native-offline-deployment.md")
    shutil.copy2(ROOT / "docs/native-offline-quickstart.md", output / "先读我.md")
    shutil.copytree(output / "licenses", payload / "licenses", dirs_exist_ok=True)
    shutil.copy2(output / "runtime-versions.json", payload / "runtime-versions.json")
    shutil.copy2(output / "windows-wheels.json", payload / "windows-wheels.json")
    files = []
    for path in sorted(payload.rglob("*")):
        if path.is_file() and path.name != "native-manifest.json" and "__pycache__" not in path.parts and path.suffix != ".pyc":
            with path.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            files.append(dict(path=path.relative_to(payload).as_posix(), bytes=path.stat().st_size, sha256=digest))
    (payload / "native-manifest.json").write_text(json.dumps(dict(format="mes-native-payload", format_version=1,
        version="2026.10.20-native.1", files=files), indent=2), encoding="utf-8")
    print(f"Native manifest: {len(files)} files, {sum(p['bytes'] for p in files)} bytes", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    finalize(parser.parse_args().output)
