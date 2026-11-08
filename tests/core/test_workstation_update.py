import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts import update_workstation_clients as updater


@pytest.fixture
def installations(tmp_path, monkeypatch):
    source, target = tmp_path / "new", tmp_path / "installed"
    for folder in (source, target):
        (folder / "station").mkdir(parents=True)
        (folder / "station/app.exe").write_bytes(b"new-exe" if folder == source else b"old-exe")
        (folder / "station/mes-client.json").write_text('{"serverUrl":"' + ("new" if folder == source else "preserve-address") + '"}')
        files = []
        for name in ["app.exe", "mes-client.json"]:
            file = folder / "station" / name
            files.append(dict(path=name, sha256=hashlib.sha256(file.read_bytes()).hexdigest(), bytes=file.stat().st_size))
        (folder / "station/client-manifest.json").write_text(json.dumps(dict(version="1.7.0" if folder == source else "1.6.0", files=files)))
        files = [dict(path=p.relative_to(folder).as_posix(), sha256=hashlib.sha256(p.read_bytes()).hexdigest(), bytes=p.stat().st_size) for p in (folder / "station").iterdir()]
        (folder / "workstations-manifest.json").write_text(json.dumps(dict(format="mes-workstation-clients", version="1.7.0" if folder == source else "1.6.0", workstations=[dict(folder="station", executable="app.exe")], files=files)))
    monkeypatch.setattr(updater.subprocess, "run", lambda *args, **kwargs: SimpleNamespace(stdout='{"state":"stopped"}'))
    return source, target, tmp_path / "backup"


def test_update_preserves_installed_address_and_recalculates_file_inventory(installations):
    source, target, backups = installations
    before = (target / "station/mes-client.json").read_bytes()
    result = updater.update(source, target, backups)
    assert result["version"] == "1.7.0" and result["configsPreserved"]
    assert (target / "station/mes-client.json").read_bytes() == before
    assert (target / "station/app.exe").read_bytes() == b"new-exe"
    manifest = json.loads((target / "workstations-manifest.json").read_text())
    assert all(hashlib.sha256((target / e["path"]).read_bytes()).hexdigest() == e["sha256"] for e in manifest["files"])


def test_corrupt_source_is_rejected_before_changing_installed_files(installations):
    source, target, backups = installations
    (source / "station/app.exe").write_bytes(b"corrupted")
    with pytest.raises(ValueError, match="checksum"):
        updater.update(source, target, backups)
    assert (target / "station/app.exe").read_bytes() == b"old-exe"
    assert not backups.exists()


def test_copy_failure_restores_previous_executable_and_manifests(installations, monkeypatch):
    source, target, backups = installations
    before = {p.relative_to(target): p.read_bytes() for p in target.rglob("*") if p.is_file()}
    original = updater.shutil.copy2
    failed = False
    def fail_once(src, dst, *args, **kwargs):
        nonlocal failed
        if Path(src) == source / "station/app.exe" and not failed:
            failed = True
            raise OSError("intentional copy failure")
        return original(src, dst, *args, **kwargs)
    monkeypatch.setattr(updater.shutil, "copy2", fail_once)
    with pytest.raises(OSError, match="intentional"):
        updater.update(source, target, backups)
    assert {p.relative_to(target): p.read_bytes() for p in target.rglob("*") if p.is_file()} == before
