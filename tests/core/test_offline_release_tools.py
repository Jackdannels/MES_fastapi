from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
from typing import Any

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
IMPORT_SCRIPT = REPO_ROOT / "scripts" / "deploy" / "Import-MesRelease.ps1"
OPERATION_SCRIPT = REPO_ROOT / "scripts" / "deploy" / "New-MesDeploymentOperation.ps1"
POWERSHELL = shutil.which("powershell.exe") or shutil.which("powershell")

REQUIRED_FILES = (
    "compose.production.yml",
    "compose.packaging.yml",
    "compose.stage4.yml",
    "deploy/.env.production.example",
    "deploy/.env.stage4.example",
    "deploy/mysql/init-users.sh",
    "deploy/nginx/production-https.conf",
    "docs/production-deployment.md",
    "mes-images.tar",
    "scripts/deploy/Backup-MesDatabase.ps1",
    "scripts/deploy/Backup-MesReports.ps1",
    "scripts/deploy/Import-MesRelease.ps1",
    "scripts/deploy/Invoke-Stage4Acceptance.ps1",
    "scripts/deploy/New-MesDeploymentOperation.ps1",
    "scripts/deploy/Restore-MesRehearsal.ps1",
    "scripts/deploy/Restore-MesReportsRehearsal.ps1",
    "scripts/deploy/Test-ProductionDeployment.ps1",
    "scripts/deploy/mysql-backup-restore.sh",
    "scripts/deploy/reports-backup-restore.py",
    "scripts/stage3a_load_probe.py",
    "scripts/stage4_soak_probe.py",
    "scripts/generate_p0_capacity_fixture.py",
    "docs/stage4-new-host-codex-handoff.md",
    "docs/stage4-long-running-acceptance.md",
)
ROLES = ("api", "web", "mysql-client", "rabbitmq", "reports-tool")


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _run_script(script: Path, *arguments: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    assert POWERSHELL is not None
    return subprocess.run(
        [POWERSHELL, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script), *arguments],
        cwd=REPO_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def _canonical_archive_name(reference: str) -> str:
    archive_reference = reference.rsplit("@", 1)[0]
    if "/" not in archive_reference:
        return f"docker.io/library/{archive_reference}"
    first = archive_reference.split("/", 1)[0]
    if "." in first or ":" in first or first == "localhost":
        return archive_reference
    return f"docker.io/{archive_reference}"


def _write_oci_archive(
    path: Path,
    images: list[dict[str, str]],
    *,
    preserve_references: bool = True,
    first_name_override: str | None = None,
    first_tag_override: str | None = None,
) -> None:
    manifests = []
    for image in images:
        reference = image["reference"]
        archive_reference, digest = reference.rsplit("@", 1)
        entry: dict[str, Any] = {
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "digest": digest,
            "size": 1,
        }
        if preserve_references:
            entry["annotations"] = {
                "io.containerd.image.name": first_name_override if not manifests and first_name_override else _canonical_archive_name(reference),
                "org.opencontainers.image.ref.name": first_tag_override if not manifests and first_tag_override else archive_reference.rsplit(":", 1)[1],
            }
        manifests.append(entry)
    index = {
        "schemaVersion": 2,
        "mediaType": "application/vnd.oci.image.index.v1+json",
        "manifests": manifests,
    }
    payload = json.dumps(index, separators=(",", ":")).encode()
    with tarfile.open(path, "w") as archive:
        member = tarfile.TarInfo("index.json")
        member.size = len(payload)
        archive.addfile(member, fileobj=__import__("io").BytesIO(payload))


def _create_release(root: Path) -> dict[str, Any]:
    release = root / "release"
    release.mkdir()
    digests = ["sha256:" + character * 64 for character in "abcde"]
    images = [
        {
            "role": role,
            "reference": f"example.invalid/mes/{role}:test-1.0.0@{digest}",
            "image_id": "sha256:" + str(index + 1) * 64,
            "os": "linux",
            "architecture": "amd64",
        }
        for index, (role, digest) in enumerate(zip(ROLES, digests))
    ]
    _write_oci_archive(release / "mes-images.tar", images)
    for relative in REQUIRED_FILES:
        path = release / Path(relative)
        if path.name == "mes-images.tar":
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"fixture:{relative}\n", encoding="utf-8")

    files = []
    for path in sorted((item for item in release.rglob("*") if item.is_file()), key=lambda item: item.relative_to(release).as_posix()):
        relative = path.relative_to(release).as_posix()
        files.append({"path": relative, "bytes": path.stat().st_size, "sha256": _sha256(path)})
    archive_entry = next(entry for entry in files if entry["path"] == "mes-images.tar")
    manifest = {
        "format": "mes-offline-release",
        "format_version": 3,
        "release_version": "test-1.0.0",
        "created_at_utc": "2026-08-02T00:00:00Z",
        "archive": {
            "path": "mes-images.tar",
            "bytes": archive_entry["bytes"],
            "sha256": archive_entry["sha256"],
        },
        "images": images,
        "files": files,
    }
    (release / "release-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"directory": release, "manifest": manifest}


@pytest.mark.skipif(POWERSHELL is None, reason="Windows PowerShell is required")
def test_v3_release_verify_only_accepts_exact_inventory(tmp_path: Path) -> None:
    fixture = _create_release(tmp_path)

    result = _run_script(IMPORT_SCRIPT, "-ReleaseDirectory", str(fixture["directory"]), "-VerifyOnly")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "Nothing was loaded or started" in result.stdout


@pytest.mark.skipif(POWERSHELL is None, reason="Windows PowerShell is required")
def test_v2_release_is_rejected(tmp_path: Path) -> None:
    fixture = _create_release(tmp_path)
    fixture["manifest"]["format_version"] = 2
    (fixture["directory"] / "release-manifest.json").write_text(
        json.dumps(fixture["manifest"], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    result = _run_script(IMPORT_SCRIPT, "-ReleaseDirectory", str(fixture["directory"]), "-VerifyOnly")

    assert result.returncode != 0
    assert "Only the current release manifest v3 format is supported" in result.stdout + result.stderr


@pytest.mark.skipif(POWERSHELL is None, reason="Windows PowerShell is required")
@pytest.mark.parametrize(
    ("mutation", "expected"),
    [
        ("traversal", "unsafe segment"),
        ("unknown", "unknown property"),
        ("duplicate_case", "Duplicate or case-colliding"),
        ("wrong_bytes", "File size mismatch"),
        ("extra_file", "missing or untracked extra files"),
        ("missing_archive_names", "does not preserve the expected image reference name"),
        ("wrong_archive_name", "does not preserve the expected image reference name"),
        ("wrong_archive_tag", "does not preserve the expected image reference name"),
        ("missing_explicit_tag", "must use repository:tag@sha256"),
    ],
)
def test_invalid_release_fails_before_any_docker_call(tmp_path: Path, mutation: str, expected: str) -> None:
    fixture = _create_release(tmp_path)
    release = fixture["directory"]
    manifest = fixture["manifest"]
    if mutation == "traversal":
        manifest["files"][0]["path"] = "../escape"
    elif mutation == "unknown":
        manifest["unexpected"] = True
    elif mutation == "duplicate_case":
        duplicate = dict(manifest["files"][0])
        duplicate["path"] = duplicate["path"].upper()
        manifest["files"].insert(1, duplicate)
    elif mutation == "wrong_bytes":
        manifest["files"][0]["bytes"] += 1
    elif mutation == "extra_file":
        (release / ".hidden-extra").write_text("unexpected", encoding="utf-8")
    elif mutation == "missing_archive_names":
        archive_path = release / "mes-images.tar"
        _write_oci_archive(archive_path, manifest["images"], preserve_references=False)
        archive_entry = next(entry for entry in manifest["files"] if entry["path"] == "mes-images.tar")
        archive_entry.update({"bytes": archive_path.stat().st_size, "sha256": _sha256(archive_path)})
        manifest["archive"].update({"bytes": archive_path.stat().st_size, "sha256": _sha256(archive_path)})
    elif mutation in {"wrong_archive_name", "wrong_archive_tag"}:
        archive_path = release / "mes-images.tar"
        _write_oci_archive(
            archive_path,
            manifest["images"],
            first_name_override="example.invalid/wrong/api:test-1.0.0" if mutation == "wrong_archive_name" else None,
            first_tag_override="wrong-tag" if mutation == "wrong_archive_tag" else None,
        )
        archive_entry = next(entry for entry in manifest["files"] if entry["path"] == "mes-images.tar")
        archive_entry.update({"bytes": archive_path.stat().st_size, "sha256": _sha256(archive_path)})
        manifest["archive"].update({"bytes": archive_path.stat().st_size, "sha256": _sha256(archive_path)})
    elif mutation == "missing_explicit_tag":
        manifest["images"][0]["reference"] = manifest["images"][0]["reference"].replace(":test-1.0.0@", "@")
    (release / "release-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    fake_bin = tmp_path / "fake-bin"
    fake_bin.mkdir()
    docker_log = tmp_path / "docker-called.log"
    (fake_bin / "docker.cmd").write_text(f"@echo %*>>\"{docker_log}\"\r\n@exit /b 99\r\n", encoding="utf-8")
    env = os.environ.copy()
    env["PATH"] = str(fake_bin) + os.pathsep + env["PATH"]

    result = _run_script(IMPORT_SCRIPT, "-ReleaseDirectory", str(release), env=env)

    assert result.returncode != 0
    assert expected.lower() in (result.stdout + result.stderr).lower()
    assert not docker_log.exists()


@pytest.mark.skipif(POWERSHELL is None, reason="Windows PowerShell is required")
def test_conflicting_preexisting_archive_tag_fails_before_docker_load(tmp_path: Path) -> None:
    fixture = _create_release(tmp_path)
    fake_bin = tmp_path / "fake-bin"
    fake_bin.mkdir()
    docker_log = tmp_path / "docker-called.log"
    conflicting_id = "sha256:" + "f" * 64
    (fake_bin / "docker.cmd").write_text(
        "@echo %*>>\"" + str(docker_log) + "\"\r\n"
        "@if \"%1 %2\"==\"image inspect\" echo [{\"Id\":\"" + conflicting_id + "\"}]&exit /b 0\r\n"
        "@exit /b 99\r\n",
        encoding="utf-8",
    )
    env = os.environ.copy()
    env["PATH"] = str(fake_bin) + os.pathsep + env["PATH"]

    result = _run_script(IMPORT_SCRIPT, "-ReleaseDirectory", str(fixture["directory"]), env=env)

    assert result.returncode != 0
    assert "Existing archive tag reference resolves to a conflicting image ID" in result.stdout + result.stderr
    assert not any(line.startswith("load ") for line in docker_log.read_text(encoding="utf-8").splitlines())


@pytest.mark.skipif(POWERSHELL is None, reason="Windows PowerShell is required")
def test_unversioned_manifest_is_rejected(tmp_path: Path) -> None:
    fixture = _create_release(tmp_path)
    release = fixture["directory"]
    manifest = fixture["manifest"]
    legacy = {
        "release_version": manifest["release_version"],
        "created_at_utc": manifest["created_at_utc"],
        "api_image": manifest["images"][0]["reference"],
        "web_image": manifest["images"][1]["reference"],
        "files": [{"path": entry["path"], "sha256": entry["sha256"]} for entry in manifest["files"]],
    }
    (release / "release-manifest.json").write_text(json.dumps(legacy), encoding="utf-8")

    result = _run_script(IMPORT_SCRIPT, "-ReleaseDirectory", str(release), "-VerifyOnly")

    assert result.returncode != 0
    assert "release manifest is missing property: format" in (result.stdout + result.stderr).lower()


@pytest.mark.skipif(POWERSHELL is None, reason="Windows PowerShell is required")
def test_operation_manifest_links_verified_release_database_and_reports(tmp_path: Path) -> None:
    fixture = _create_release(tmp_path)
    release = fixture["directory"]
    images = {entry["role"]: entry["reference"] for entry in fixture["manifest"]["images"]}

    database = tmp_path / "database"
    database.mkdir()
    dump = database / "database.sql"
    dump.write_text("CREATE TABLE rehearsal(id INT);\n", encoding="utf-8")
    database_manifest = {
        "format_version": 1,
        "database": "mes_rehearsal",
        "source_host": "isolated.invalid",
        "source_port": 3306,
        "created_at_utc": "2026-08-02T00:00:00Z",
        "dump_file": dump.name,
        "dump_bytes": dump.stat().st_size,
        "dump_sha256": _sha256(dump),
        "client_image": images["mysql-client"],
    }
    (database / "backup-manifest.json").write_text(json.dumps(database_manifest), encoding="utf-8")

    reports = tmp_path / "reports"
    reports.mkdir()
    archive = reports / "mes-reports.tar.gz"
    archive.write_bytes(b"reports-fixture")
    reports_manifest = {
        "format": "mes-reports-backup",
        "format_version": 1,
        "backup_id": "11111111-1111-1111-1111-111111111111",
        "created_at_utc": "2026-08-02T00:00:00Z",
        "source_volume": "isolated-reports",
        "consistency_mode": "offline",
        "tool_image": images["reports-tool"],
        "archive": {"file": archive.name, "format": "tar.gz", "bytes": archive.stat().st_size, "sha256": _sha256(archive)},
        "content": {"directory_count": 0, "file_count": 0, "total_bytes": 0, "directories": [], "files": []},
    }
    (reports / "reports-manifest.json").write_text(json.dumps(reports_manifest), encoding="utf-8")

    output = tmp_path / "operation-manifest.json"
    result = _run_script(
        OPERATION_SCRIPT,
        "-ReleaseDirectory", str(release),
        "-DatabaseBackupDirectory", str(database),
        "-ReportsBackupDirectory", str(reports),
        "-PreviousApiImage", "example.invalid/mes/api@sha256:" + "e" * 64,
        "-PreviousWebImage", "example.invalid/mes/web@sha256:" + "f" * 64,
        "-OutputFile", str(output),
    )

    assert result.returncode == 0, result.stdout + result.stderr
    operation = json.loads(output.read_text(encoding="utf-8-sig"))
    assert operation["format"] == "mes-deployment-operation"
    assert operation["release_version"] == fixture["manifest"]["release_version"]
    assert operation["artifacts"]["database"]["dump_sha256"] == _sha256(dump)
    assert operation["artifacts"]["reports"]["archive_sha256"] == _sha256(archive)
