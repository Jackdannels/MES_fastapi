#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from typing import Iterable
from uuid import UUID


ARCHIVE_NAME = "mes-reports.tar.gz"
MANIFEST_NAME = "reports-manifest.json"
FORMAT_NAME = "mes-reports-backup"
FORMAT_VERSION = 1
CHUNK_SIZE = 1024 * 1024


class ReportsBackupError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise ReportsBackupError(message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_relative_path(value: object) -> str:
    if not isinstance(value, str) or not value:
        fail("Manifest/archive path must be a non-empty string.")
    if "\\" in value or any(ord(character) < 32 or ord(character) == 127 for character in value):
        fail(f"Unsafe control character or backslash in path: {value!r}")
    path = PurePosixPath(value)
    if path.is_absolute() or path.as_posix() != value:
        fail(f"Path is not a canonical POSIX relative path: {value!r}")
    if any(part in ("", ".", "..") for part in path.parts):
        fail(f"Unsafe path component: {value!r}")
    if path.parts and len(path.parts[0]) >= 2 and path.parts[0][1] == ":":
        fail(f"Windows drive path is not allowed: {value!r}")
    return value


def validate_leaf_name(value: object) -> str:
    name = validate_relative_path(value)
    if len(PurePosixPath(name).parts) != 1:
        fail("Archive file must be a single file name.")
    return name


def _stat_signature(info: os.stat_result) -> tuple[int, ...]:
    return (
        info.st_dev,
        info.st_ino,
        stat.S_IFMT(info.st_mode),
        info.st_size,
        info.st_mtime_ns,
    )


def _hash_stable_file(path: Path, initial: os.stat_result) -> str:
    if initial.st_nlink != 1:
        fail(f"Hard-linked report file is not supported: {path}")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        opened = os.fstat(stream.fileno())
        if opened.st_nlink != 1 or _stat_signature(opened) != _stat_signature(initial):
            fail(f"Report file changed before it could be read: {path}")
        for chunk in iter(lambda: stream.read(CHUNK_SIZE), b""):
            digest.update(chunk)
        after_read = os.fstat(stream.fileno())
    after_close = path.lstat()
    if (
        after_read.st_nlink != 1
        or after_close.st_nlink != 1
        or _stat_signature(after_read) != _stat_signature(initial)
        or _stat_signature(after_close) != _stat_signature(initial)
    ):
        fail(f"Report file changed while it was being read: {path}")
    return digest.hexdigest()


def collect_tree(root: Path) -> tuple[list[str], list[dict[str, object]]]:
    directories: list[str] = []
    files: list[dict[str, object]] = []
    if not root.is_dir():
        fail(f"Report root is not a directory: {root}")

    for current, dir_names, file_names in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        dir_names.sort()
        file_names.sort()
        for name in dir_names:
            path = current_path / name
            info = path.lstat()
            relative = validate_relative_path(path.relative_to(root).as_posix())
            if not stat.S_ISDIR(info.st_mode):
                fail(f"Only real directories are allowed in report backups: {relative}")
            directories.append(relative)
        for name in file_names:
            path = current_path / name
            info = path.lstat()
            relative = validate_relative_path(path.relative_to(root).as_posix())
            if not stat.S_ISREG(info.st_mode):
                fail(f"Only regular files are allowed in report backups: {relative}")
            files.append({
                "path": relative,
                "bytes": info.st_size,
                "sha256": _hash_stable_file(path, info),
            })

    directories.sort()
    files.sort(key=lambda entry: str(entry["path"]))
    return directories, files


def _tar_info(name: str, *, is_directory: bool, size: int = 0, mtime: int = 0) -> tarfile.TarInfo:
    info = tarfile.TarInfo(name)
    info.type = tarfile.DIRTYPE if is_directory else tarfile.REGTYPE
    info.size = 0 if is_directory else size
    info.mode = 0o750 if is_directory else 0o640
    info.uid = 0
    info.gid = 0
    info.uname = ""
    info.gname = ""
    info.mtime = mtime
    return info


def create_archive(root: Path, archive_path: Path, directories: Iterable[str], files: Iterable[dict[str, object]]) -> None:
    with tarfile.open(archive_path, "w:gz", format=tarfile.PAX_FORMAT) as archive:
        for relative in directories:
            source = root / PurePosixPath(relative)
            source_stat = source.lstat()
            if not stat.S_ISDIR(source_stat.st_mode):
                fail(f"Report directory changed during backup: {relative}")
            archive.addfile(_tar_info(relative, is_directory=True, mtime=int(source_stat.st_mtime)))
        for entry in files:
            relative = str(entry["path"])
            source = root / PurePosixPath(relative)
            source_stat = source.lstat()
            if not stat.S_ISREG(source_stat.st_mode) or source_stat.st_nlink != 1:
                fail(f"Report file type changed during backup: {relative}")
            info = _tar_info(relative, is_directory=False, size=source_stat.st_size, mtime=int(source_stat.st_mtime))
            with source.open("rb") as stream:
                opened = os.fstat(stream.fileno())
                if opened.st_nlink != 1 or _stat_signature(opened) != _stat_signature(source_stat):
                    fail(f"Report file changed before archiving: {relative}")
                archive.addfile(info, stream)
                after = os.fstat(stream.fileno())
            after_close = source.lstat()
            if (
                after.st_nlink != 1
                or after_close.st_nlink != 1
                or _stat_signature(after) != _stat_signature(source_stat)
                or _stat_signature(after_close) != _stat_signature(source_stat)
            ):
                fail(f"Report file changed while archiving: {relative}")


def inspect_archive(archive_path: Path) -> tuple[list[str], list[dict[str, object]]]:
    directories: list[str] = []
    files: list[dict[str, object]] = []
    seen: set[str] = set()
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive.getmembers():
            name = validate_relative_path(member.name)
            if name in seen:
                fail(f"Duplicate archive member: {name}")
            seen.add(name)
            if member.isdir():
                directories.append(name)
                continue
            if not member.isreg():
                fail(f"Archive links and special members are not allowed: {name}")
            extracted = archive.extractfile(member)
            if extracted is None:
                fail(f"Could not read archive member: {name}")
            digest = hashlib.sha256()
            size = 0
            with extracted:
                for chunk in iter(lambda: extracted.read(CHUNK_SIZE), b""):
                    size += len(chunk)
                    digest.update(chunk)
            if size != member.size:
                fail(f"Archive member size changed while reading: {name}")
            files.append({"path": name, "bytes": size, "sha256": digest.hexdigest()})
    directories.sort()
    files.sort(key=lambda entry: str(entry["path"]))
    return directories, files


def _require_int(value: object, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        fail(f"{name} must be a non-negative integer.")
    return value


def _require_sha256(value: object, name: str) -> str:
    if not isinstance(value, str) or len(value) != 64 or value.lower() != value:
        fail(f"{name} must be a lowercase SHA-256 digest.")
    try:
        int(value, 16)
    except ValueError as error:
        raise ReportsBackupError(f"{name} must be a lowercase SHA-256 digest.") from error
    return value


def validate_manifest(data: object) -> dict[str, object]:
    if not isinstance(data, dict):
        fail("Report backup manifest must be a JSON object.")
    if data.get("format") != FORMAT_NAME or data.get("format_version") != FORMAT_VERSION:
        fail("Unsupported report backup manifest format or version.")
    try:
        UUID(str(data.get("backup_id")))
        datetime.fromisoformat(str(data.get("created_at_utc")).replace("Z", "+00:00"))
    except (ValueError, TypeError) as error:
        raise ReportsBackupError("Invalid backup identity or timestamp.") from error
    if data.get("consistency_mode") not in {"offline", "quiesced", "live_best_effort"}:
        fail("Unsupported report backup consistency mode.")
    if not isinstance(data.get("source_volume"), str) or not data["source_volume"]:
        fail("Manifest source_volume is missing.")
    tool_image = data.get("tool_image")
    if not isinstance(tool_image, str) or "@sha256:" not in tool_image or len(tool_image.rsplit("@sha256:", 1)[1]) != 64:
        fail("Manifest tool_image is not immutable.")

    archive = data.get("archive")
    content = data.get("content")
    if not isinstance(archive, dict) or not isinstance(content, dict):
        fail("Manifest archive/content sections are required.")
    validate_leaf_name(archive.get("file"))
    if archive.get("format") != "tar.gz":
        fail("Unsupported report archive format.")
    _require_int(archive.get("bytes"), "archive.bytes")
    _require_sha256(archive.get("sha256"), "archive.sha256")

    raw_directories = content.get("directories")
    raw_files = content.get("files")
    if not isinstance(raw_directories, list) or not isinstance(raw_files, list):
        fail("Manifest directories/files must be arrays.")
    directories = [validate_relative_path(value) for value in raw_directories]
    if directories != sorted(directories) or len(directories) != len(set(directories)):
        fail("Manifest directories must be unique and sorted.")

    files: list[dict[str, object]] = []
    for index, raw in enumerate(raw_files):
        if not isinstance(raw, dict):
            fail(f"Manifest file entry {index} must be an object.")
        files.append({
            "path": validate_relative_path(raw.get("path")),
            "bytes": _require_int(raw.get("bytes"), f"content.files[{index}].bytes"),
            "sha256": _require_sha256(raw.get("sha256"), f"content.files[{index}].sha256"),
        })
    file_paths = [str(entry["path"]) for entry in files]
    if file_paths != sorted(file_paths) or len(file_paths) != len(set(file_paths)):
        fail("Manifest file paths must be unique and sorted.")
    if set(directories).intersection(file_paths):
        fail("A manifest path cannot be both a file and a directory.")
    for path in file_paths:
        parent = PurePosixPath(path).parent
        while parent != PurePosixPath("."):
            if parent.as_posix() not in directories:
                fail(f"Manifest is missing parent directory: {parent}")
            parent = parent.parent

    if _require_int(content.get("directory_count"), "content.directory_count") != len(directories):
        fail("Manifest directory_count does not match directories.")
    if _require_int(content.get("file_count"), "content.file_count") != len(files):
        fail("Manifest file_count does not match files.")
    if _require_int(content.get("total_bytes"), "content.total_bytes") != sum(int(entry["bytes"]) for entry in files):
        fail("Manifest total_bytes does not match files.")
    return data


def write_manifest(path: Path, data: dict[str, object]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def backup() -> None:
    source = Path("/reports")
    output = Path("/backup")
    if any(output.iterdir()):
        fail("Backup output directory must be empty.")
    source_volume = os.environ["MES_REPORTS_SOURCE_VOLUME"]
    tool_image = os.environ["MES_REPORTS_TOOL_IMAGE"]
    backup_id = str(UUID(os.environ["MES_REPORTS_BACKUP_ID"]))
    consistency_mode = os.environ["MES_REPORTS_CONSISTENCY_MODE"]
    if consistency_mode not in {"offline", "quiesced", "live_best_effort"}:
        fail("Unsupported consistency mode.")

    before_directories, before_files = collect_tree(source)
    archive_path = output / ARCHIVE_NAME
    create_archive(source, archive_path, before_directories, before_files)
    archive_directories, archive_files = inspect_archive(archive_path)
    after_directories, after_files = collect_tree(source)
    if (archive_directories, archive_files) != (before_directories, before_files) or (archive_directories, archive_files) != (after_directories, after_files):
        fail("Report volume changed during backup; archive was not accepted as consistent.")

    manifest: dict[str, object] = {
        "format": FORMAT_NAME,
        "format_version": FORMAT_VERSION,
        "backup_id": backup_id,
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "source_volume": source_volume,
        "consistency_mode": consistency_mode,
        "tool_image": tool_image,
        "archive": {
            "file": ARCHIVE_NAME,
            "format": "tar.gz",
            "bytes": archive_path.stat().st_size,
            "sha256": sha256_file(archive_path),
        },
        "content": {
            "directory_count": len(archive_directories),
            "file_count": len(archive_files),
            "total_bytes": sum(int(entry["bytes"]) for entry in archive_files),
            "directories": archive_directories,
            "files": archive_files,
        },
    }
    validate_manifest(manifest)
    write_manifest(output / MANIFEST_NAME, manifest)


def _load_and_verify_backup(backup_root: Path) -> tuple[dict[str, object], Path, list[str], list[dict[str, object]]]:
    manifest_path = backup_root / MANIFEST_NAME
    try:
        with manifest_path.open("r", encoding="utf-8-sig") as stream:
            manifest = validate_manifest(json.load(stream))
    except (OSError, json.JSONDecodeError) as error:
        raise ReportsBackupError("Could not read report backup manifest.") from error
    archive_data = manifest["archive"]
    assert isinstance(archive_data, dict)
    archive_path = backup_root / str(archive_data["file"])
    if not archive_path.is_file():
        fail("Report backup archive is missing.")
    if archive_path.stat().st_size != archive_data["bytes"] or sha256_file(archive_path) != archive_data["sha256"]:
        fail("Report backup archive size or SHA-256 does not match the manifest.")
    directories, files = inspect_archive(archive_path)
    content = manifest["content"]
    assert isinstance(content, dict)
    if directories != content["directories"] or files != content["files"]:
        fail("Report archive contents do not match the manifest.")
    return manifest, archive_path, directories, files


def _extract_to_staging(archive_path: Path, staging: Path, directories: list[str], files: list[dict[str, object]]) -> None:
    for relative in sorted(directories, key=lambda value: (len(PurePosixPath(value).parts), value)):
        destination = staging.joinpath(*PurePosixPath(relative).parts)
        destination.mkdir(exist_ok=False)
    file_map = {str(entry["path"]): entry for entry in files}
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive.getmembers():
            if member.isdir():
                continue
            entry = file_map[member.name]
            source = archive.extractfile(member)
            if source is None:
                fail(f"Could not extract report file: {member.name}")
            destination = staging.joinpath(*PurePosixPath(member.name).parts)
            digest = hashlib.sha256()
            size = 0
            with source, destination.open("xb") as target:
                for chunk in iter(lambda: source.read(CHUNK_SIZE), b""):
                    target.write(chunk)
                    size += len(chunk)
                    digest.update(chunk)
            if size != entry["bytes"] or digest.hexdigest() != entry["sha256"]:
                fail(f"Extracted report file failed verification: {member.name}")


def _copy_staging(staging: Path, target: Path, directories: list[str], files: list[dict[str, object]], uid: int, gid: int) -> None:
    if any(target.iterdir()):
        fail("Target report volume is not empty.")
    for relative in sorted(directories, key=lambda value: (len(PurePosixPath(value).parts), value)):
        destination = target.joinpath(*PurePosixPath(relative).parts)
        destination.mkdir(exist_ok=False)
    for entry in files:
        relative = str(entry["path"])
        source = staging.joinpath(*PurePosixPath(relative).parts)
        destination = target.joinpath(*PurePosixPath(relative).parts)
        with source.open("rb") as input_stream, destination.open("xb") as output_stream:
            shutil.copyfileobj(input_stream, output_stream, length=CHUNK_SIZE)
        os.chmod(destination, 0o640)
        os.chown(destination, uid, gid)
    for relative in sorted(directories, key=lambda value: (-len(PurePosixPath(value).parts), value)):
        destination = target.joinpath(*PurePosixPath(relative).parts)
        os.chmod(destination, 0o750)
        os.chown(destination, uid, gid)
    os.chmod(target, 0o750)
    os.chown(target, uid, gid)


def restore() -> None:
    backup_root = Path("/backup")
    target = Path("/restore")
    if any(target.iterdir()):
        fail("Target report volume is not empty.")
    uid = int(os.environ["MES_REPORTS_TARGET_UID"])
    gid = int(os.environ["MES_REPORTS_TARGET_GID"])
    if uid < 0 or gid < 0:
        fail("Target UID/GID must be non-negative.")
    manifest, archive_path, directories, files = _load_and_verify_backup(backup_root)
    expected_archive_sha = str(manifest["archive"]["sha256"])  # type: ignore[index]
    with tempfile.TemporaryDirectory(prefix="mes-reports-restore-") as temporary:
        staging = Path(temporary)
        _extract_to_staging(archive_path, staging, directories, files)
        staged_directories, staged_files = collect_tree(staging)
        if staged_directories != directories or staged_files != files:
            fail("Staged report files do not match the manifest.")
        if sha256_file(archive_path) != expected_archive_sha:
            fail("Report archive changed during restore verification.")
        _copy_staging(staging, target, directories, files, uid, gid)
    restored_directories, restored_files = collect_tree(target)
    if restored_directories != directories or restored_files != files:
        fail("Restored report volume does not match the manifest.")


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[1] not in {"backup", "restore"}:
        print("Usage: reports-backup-restore.py <backup|restore>", file=sys.stderr)
        return 2
    try:
        backup() if argv[1] == "backup" else restore()
    except (KeyError, OSError, ReportsBackupError, tarfile.TarError, ValueError) as error:
        print(f"reports-backup-restore: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
