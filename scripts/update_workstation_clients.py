"""Update a workstation collection in place, retaining configurations and local credentials."""
from datetime import datetime
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import uuid


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def child(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()) or path == root.resolve():
        raise ValueError("Manifest path escapes the installation directory.")
    return path


def update(source, target, backup_root):
    source, target = source.resolve(), target.resolve()
    if source == target or source.is_relative_to(target) or target.is_relative_to(source):
        raise ValueError("Source and target must be separate directories.")
    manifest = json.loads((source / "workstations-manifest.json").read_text(encoding="utf-8-sig"))
    if manifest["format"] != "mes-workstation-clients":
        raise ValueError("Invalid workstation build.")
    for entry in manifest["files"]:
        if digest(child(source, entry["path"])) != entry["sha256"]:
            raise ValueError("Source checksum mismatch: " + entry["path"])
    configs = {s["folder"] + "/mes-client.json": child(target, s["folder"] + "/mes-client.json").read_bytes()
               for s in manifest["workstations"]}
    previously_running = []
    for station in manifest["workstations"]:
        exe = child(target, station["folder"] + "/" + station["executable"])
        status = subprocess.run([str(exe), "--status"], capture_output=True, text=True, encoding="utf-8", timeout=25, check=True)
        if json.loads(status.stdout)["state"] != "stopped":
            subprocess.run([str(exe), "--close"], capture_output=True, timeout=25, check=True)
            previously_running.append(exe)
    backup = backup_root / (datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8])
    backup.mkdir(parents=True)
    candidates = [e["path"] for e in manifest["files"] if e["path"] not in configs]
    candidates += ["workstations-manifest.json"]
    saved = []
    try:
        for relative in candidates:
            destination = child(target, relative)
            existing = destination.exists()
            if existing:
                original = child(backup, relative)
                original.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(destination, original)
            saved.append((relative, existing))
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(child(source, relative), destination)
            if digest(destination) != digest(child(source, relative)):
                raise RuntimeError("Copied file checksum mismatch: " + relative)
        for relative, content in configs.items():
            if child(target, relative).read_bytes() != content:
                raise RuntimeError("Configuration changed during update.")
        for station in manifest["workstations"]:
            folder = child(target, station["folder"])
            subprocess.run([str(child(folder, station["executable"])), "--validate-config"], capture_output=True, timeout=25, check=True)
            path = folder / "client-manifest.json"
            client = json.loads(path.read_text(encoding="utf-8-sig"))
            for entry in client["files"]:
                file = child(folder, entry["path"])
                entry.update(bytes=file.stat().st_size, sha256=digest(file))
            path.write_text(json.dumps(client, ensure_ascii=False, indent=2), encoding="utf-8")
        for entry in manifest["files"]:
            file = child(target, entry["path"])
            entry.update(bytes=file.stat().st_size, sha256=digest(file))
        (target / "workstations-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        for relative, existed in reversed(saved):
            destination = child(target, relative)
            if existed:
                shutil.copy2(child(backup, relative), destination)
            elif destination.exists():
                destination.unlink()
        raise
    return {"version": manifest["version"], "configsPreserved": True, "backup": str(backup),
            "previouslyRunning": [str(exe) for exe in previously_running]}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--target", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(update(args.source, args.target, Path(__file__).resolve().parents[1] / ".tmp/desktop-client-workstation-backups")))
