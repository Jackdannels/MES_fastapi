from scripts.clear_test_data_history import clear_test_data_history, main


class FakeCursor:
    rowcount = 3

    def __init__(self) -> None:
        self.statements: list[str] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        return None

    def execute(self, statement: str) -> None:
        self.statements.append(statement)


class FakeConnection:
    def __init__(self) -> None:
        self.cursor_instance = FakeCursor()
        self.committed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        return None

    def cursor(self) -> FakeCursor:
        return self.cursor_instance

    def commit(self) -> None:
        self.committed = True


def test_clear_test_data_history_only_deletes_data_stream_rows(monkeypatch) -> None:
    connection = FakeConnection()
    monkeypatch.setattr("scripts.clear_test_data_history.get_connection", lambda: connection)

    assert clear_test_data_history() == 3
    assert connection.cursor_instance.statements == ["DELETE FROM biz_data_stream"]
    assert connection.committed is True


def test_clear_test_data_history_requires_explicit_confirmation() -> None:
    try:
        main([])
    except SystemExit as exc:
        assert exc.code == 2
    else:
        raise AssertionError("main() should require --confirm")
