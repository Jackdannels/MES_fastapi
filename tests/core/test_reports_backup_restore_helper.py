from __future__ import annotations

import importlib.util
import io
from pathlib import Path
import tarfile

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
HELPER_PATH = REPO_ROOT / "scripts" / "deploy" / "reports-backup-restore.py"


@pytest.fixture(scope="module")
def helper():
    spec = importlib.util.spec_from_file_location("reports_backup_restore", HELPER_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _write_member(archive: tarfile.TarFile, name: str, content: bytes = b"report") -> None:
    member = tarfile.TarInfo(name)
    member.size = len(content)
    archive.addfile(member, io.BytesIO(content))


def test_helper_round_trips_unicode_spaces_binary_and_empty_directories(helper, tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "中文 报告").mkdir()
    (source / "空目录").mkdir()
    (source / "中文 报告" / "result data.bin").write_bytes(bytes(range(256)))
    (source / "root.txt").write_text("MES report\n", encoding="utf-8")

    directories, files = helper.collect_tree(source)
    archive = tmp_path / "reports.tar.gz"
    helper.create_archive(source, archive, directories, files)

    assert helper.inspect_archive(archive) == (directories, files)
    assert directories == ["中文 报告", "空目录"]
    assert [entry["path"] for entry in files] == ["root.txt", "中文 报告/result data.bin"]


@pytest.mark.parametrize("member_name", ["../escape", "/absolute", "C:/drive", "safe\\windows", "a/./b"])
def test_helper_rejects_unsafe_archive_paths(helper, tmp_path: Path, member_name: str) -> None:
    archive_path = tmp_path / (str(abs(hash(member_name))) + ".tar.gz")
    with tarfile.open(archive_path, "w:gz") as archive:
        _write_member(archive, member_name)

    with pytest.raises(helper.ReportsBackupError):
        helper.inspect_archive(archive_path)


@pytest.mark.parametrize("member_type", [tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE])
def test_helper_rejects_links_and_special_archive_members(helper, tmp_path: Path, member_type: bytes) -> None:
    archive_path = tmp_path / (member_type.hex() + ".tar.gz")
    with tarfile.open(archive_path, "w:gz") as archive:
        member = tarfile.TarInfo("unsafe")
        member.type = member_type
        member.linkname = "target"
        archive.addfile(member)

    with pytest.raises(helper.ReportsBackupError, match="links and special"):
        helper.inspect_archive(archive_path)


def test_helper_rejects_duplicate_archive_members(helper, tmp_path: Path) -> None:
    archive_path = tmp_path / "duplicate.tar.gz"
    with tarfile.open(archive_path, "w:gz") as archive:
        _write_member(archive, "duplicate.txt", b"first")
        _write_member(archive, "duplicate.txt", b"second")

    with pytest.raises(helper.ReportsBackupError, match="Duplicate archive member"):
        helper.inspect_archive(archive_path)
