import importlib.util
import json
from pathlib import Path
import sqlite3

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("portable_data", ROOT / "scripts/deploy/portable_data.py")
data = importlib.util.module_from_spec(spec)
spec.loader.exec_module(data)


def backup_fixture(root):
    root.mkdir()
    (root / "database.sql").write_text("CREATE TABLE example (id INT);", encoding="utf-8")
    (root / "lims").mkdir()
    for name in ("task-sequence.sqlite3", "interactions.sqlite3", "communication.sqlite3"):
        with sqlite3.connect(root / "lims" / name) as connection:
            connection.execute("CREATE TABLE example (id INT)")
    manifest = {"format": "mes-portable-data", "format_version": 1, "files": data.inventory(root)}
    (root / "data-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return manifest


def test_data_verification_detects_corruption_and_extra_files(tmp_path):
    root = tmp_path / "backup"
    backup_fixture(root)
    before = {item.relative_to(root) for item in root.rglob("*")}
    data.verify(root)
    assert {item.relative_to(root) for item in root.rglob("*")} == before
    (root / "extra.txt").write_text("unexpected")
    with pytest.raises(ValueError, match="inventory"):
        data.verify(root)
    (root / "extra.txt").unlink()
    (root / "database.sql").write_text("changed")
    with pytest.raises(ValueError, match="checksum"):
        data.verify(root)


@pytest.mark.parametrize("name", ["../outside", "/tmp/outside", "C:\\outside", "folder/../../outside", "a:b"])
def test_report_path_conversion_rejects_escape(name, tmp_path):
    with pytest.raises(ValueError):
        data.rebase_export({"filePath": "C:/old/file.pdf", "relativePath": name}, tmp_path)


def test_windows_report_paths_are_rebased_and_missing_reports_rejected(tmp_path):
    report = tmp_path / "task" / "report.pdf"
    report.parent.mkdir()
    report.write_bytes(b"historical report")
    original = {"filePath": r"C:\old\task\report.pdf", "relativePath": r"task\report.pdf", "status": "success"}
    changed = data.rebase_export(original, tmp_path)
    assert changed["filePath"] == str(report)
    assert changed["relativePath"] == "task/report.pdf"
    assert original["filePath"].startswith("C:")
    report.unlink()
    with pytest.raises(ValueError, match="missing"):
        data.rebase_export(original, tmp_path)


def test_sqlite_backup_includes_committed_wal_data(tmp_path):
    source = tmp_path / "live.sqlite3"
    with sqlite3.connect(source) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("CREATE TABLE sequence (number INT)")
        connection.execute("INSERT INTO sequence VALUES (42)")
        connection.commit()
        target = tmp_path / "copy.sqlite3"
        data.sqlite_snapshot(source, target)
    with sqlite3.connect(target) as copy:
        assert copy.execute("SELECT number FROM sequence").fetchone() == (42,)


def test_all_registered_schema_migrations_are_in_api_image():
    import ast
    tree = ast.parse((ROOT / "scripts/init_mysql_storage.py").read_text(encoding="utf-8"))
    sql_files = [node.value for node in ast.walk(tree) if isinstance(node, ast.Constant)
                 and isinstance(node.value, str) and node.value.endswith(".sql")]
    dockerfile = (ROOT / "deploy/docker/Dockerfile.api").read_text(encoding="utf-8")
    assert len(sql_files) >= 11
    for name in sql_files:
        assert f"scripts/sql/{name} /app/scripts/sql/{name}" in dockerfile
