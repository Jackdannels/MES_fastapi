from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
GRANTS_SQL = REPO_ROOT / "scripts" / "sql" / "mysql-production-grants.example.sql"


def test_runtime_api_grant_is_dml_only() -> None:
    sql = GRANTS_SQL.read_text(encoding="utf-8")
    api_grant = next(
        statement
        for statement in sql.split(";")
        if "TO 'mes_api'" in statement
    ).upper()

    for permission in ("SELECT", "INSERT", "UPDATE", "DELETE"):
        assert permission in api_grant
    for forbidden in ("CREATE", "ALTER", "DROP", "INDEX", "EXECUTE"):
        assert forbidden not in api_grant


def test_migration_grant_supports_versioned_schema_sql() -> None:
    sql = GRANTS_SQL.read_text(encoding="utf-8")
    migration_grant = next(
        statement
        for statement in sql.split(";")
        if "TO 'mes_migrator'" in statement
    ).upper()

    for permission in (
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "CREATE",
        "ALTER",
        "DROP",
        "INDEX",
        "REFERENCES",
        "CREATE ROUTINE",
        "ALTER ROUTINE",
        "EXECUTE",
    ):
        assert permission in migration_grant
