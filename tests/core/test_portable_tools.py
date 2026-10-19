import hashlib
import json
from pathlib import Path
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/deploy/Mes-Portable.ps1"
PS = shutil.which("powershell.exe") or shutil.which("powershell")
pytestmark = pytest.mark.skipif(not PS, reason="PowerShell is required")


def run(*args):
    return subprocess.run([PS, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(SCRIPT), *map(str, args)],
                          cwd=ROOT, capture_output=True, text=True, check=False)


def make_bundle(root):
    root.mkdir()
    packages, files = [], []
    for name, roles in {"mes-core": ("api", "web", "mysql", "rabbitmq"),
                        "lims-simulator": ("lims-simulator",), "upper-simulator": ("upper-simulator",)}.items():
        relative = f"{name}/images.tar"
        path = root / relative
        path.parent.mkdir()
        path.write_bytes(b"archive bytes for checksum verification")
        files.append({"path": relative, "bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        packages.append({"name": name, "archive": relative,
                         "images": [{"role": role, "reference": f"mes/{role}:test", "image_id": "sha256:" + "a" * 64,
                                     "os": "linux", "architecture": "amd64"} for role in roles]})
    manifest = {"format": "mes-portable-release", "format_version": 1, "packages": packages, "files": files}
    (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return manifest


def test_initialize_generates_distinct_secrets_and_refuses_overwrite(tmp_path):
    path = tmp_path / "portable.env"
    result = run("-Action", "Initialize", "-EnvFile", path, "-ReleaseVersion", "test-1")
    assert result.returncode == 0, result.stderr
    text = path.read_text(encoding="utf-8")
    assert "MES_RELEASE_VERSION=test-1" in text
    secrets = [line.split("=", 1)[1] for line in text.splitlines()
               if line.startswith(("MYSQL_ROOT_PASSWORD=", "MYSQL_API_PASSWORD=", "MYSQL_MIGRATION_PASSWORD=",
                                   "RABBITMQ_PASSWORD=", "SESSION_SECRET_KEY=", "LIMS_HTTP_TOKEN=", "MES_LOGIN_PASSWORD="))]
    assert len(secrets) == len(set(secrets)) == 7
    assert all(len(value) == 64 for value in secrets)
    before = path.read_bytes()
    assert run("-Action", "Initialize", "-EnvFile", path).returncode != 0
    assert path.read_bytes() == before


def test_release_verification_checks_integrity_without_docker(tmp_path):
    root = tmp_path / "release"
    make_bundle(root)
    result = run("-Action", "Verify", "-OutputDirectory", root)
    assert result.returncode == 0, result.stderr
    (root / "mes-core/images.tar").write_bytes(b"corrupt")
    result = run("-Action", "Verify", "-OutputDirectory", root)
    assert result.returncode != 0
    assert "Checksum mismatch" in result.stderr


@pytest.mark.parametrize("mutation", ["escape", "duplicate-package", "extra-file", "wrong-role"])
def test_release_verification_rejects_invalid_inventory(tmp_path, mutation):
    root = tmp_path / "release"
    manifest = make_bundle(root)
    if mutation == "escape":
        manifest["files"][0]["path"] = "../outside.tar"
    elif mutation == "duplicate-package":
        manifest["packages"][1] = manifest["packages"][0]
    elif mutation == "wrong-role":
        manifest["packages"][0]["images"][0]["role"] = "unrelated"
    else:
        (root / "extra.txt").write_text("untracked")
    (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    result = run("-Action", "Verify", "-OutputDirectory", root)
    assert result.returncode != 0
