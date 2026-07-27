from app.services import test_data_cleanup, test_data_reports


class FakeStorage:
    def __init__(self, values):
        self.values = dict(values)

    def read(self, key):
        value = self.values.get(key, [])
        return [dict(item) for item in value] if isinstance(value, list) else value

    def write_many(self, updates):
        self.values.update(updates)

    def write(self, key, value):
        self.values[key] = value


def test_clear_all_test_data_files_deletes_managed_pdfs_and_preserves_roots_settings_and_unrelated_files(tmp_path):
    current_root = tmp_path / "current"
    previous_root = tmp_path / "previous"
    current_pdf = current_root / "TASK-1" / "振动试验" / "X轴向" / "2026-07-27 09.40-10.00" / "SP-1.pdf"
    previous_pdf = previous_root / "TASK-OLD" / "冲击试验" / "2026-07-26 09.40-10.00" / "SP-OLD.pdf"
    unrelated = current_root / "请勿删除.txt"
    for path in (current_pdf, previous_pdf, unrelated):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"data")

    settings = [{"savePath": str(current_root), "updatedAt": "2026-07-27 10:00:00"}]
    exports = [
        {
            "exportKey": "RUN-1|x+|SP-1",
            "filePath": str(current_pdf),
            "relativePath": str(current_pdf.relative_to(current_root)),
            "status": "success",
        },
        {
            "exportKey": "RUN-OLD||SP-OLD",
            "filePath": str(previous_pdf),
            "relativePath": str(previous_pdf.relative_to(previous_root)),
            "status": "success",
        },
    ]
    storage = FakeStorage(
        {
            test_data_reports.SETTINGS_STORAGE_KEY: settings,
            test_data_reports.EXPORTS_STORAGE_KEY: exports,
            "mes.test_data_shares": [{"token": "secret"}],
        }
    )

    result = test_data_cleanup.clear_all_test_data_files(storage=storage)

    assert result == {"deleted_file_count": 2, "missing_file_count": 0, "cleared_export_count": 2}
    assert not current_pdf.exists()
    assert not previous_pdf.exists()
    assert current_root.is_dir()
    assert previous_root.is_dir()
    assert unrelated.read_text(encoding="utf-8") == "data"
    assert storage.values[test_data_reports.SETTINGS_STORAGE_KEY] == settings
    assert storage.values[test_data_reports.EXPORTS_STORAGE_KEY] == []
    assert storage.values["mes.test_data_shares"] == []


def test_clear_all_test_data_files_ignores_untrusted_relative_path_outside_root(tmp_path):
    root = tmp_path / "reports"
    root.mkdir()
    outside = tmp_path / "outside.pdf"
    outside.write_bytes(b"keep")
    storage = FakeStorage(
        {
            test_data_reports.SETTINGS_STORAGE_KEY: [{"savePath": str(root)}],
            test_data_reports.EXPORTS_STORAGE_KEY: [
                {"exportKey": "unsafe", "relativePath": "../outside.pdf", "status": "success"}
            ],
        }
    )

    result = test_data_cleanup.clear_all_test_data_files(storage=storage)

    assert outside.read_bytes() == b"keep"
    assert result["deleted_file_count"] == 0
    assert storage.values[test_data_reports.EXPORTS_STORAGE_KEY] == []
