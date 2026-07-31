from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = PROJECT_ROOT / "scripts" / "sql" / "0001-complete-baseline-schema.sql"
DEFAULT_OUTPUT = PROJECT_ROOT / "app" / "db" / "schema_contract.json"

_CREATE_TABLE_RE = re.compile(
    r"CREATE TABLE IF NOT EXISTS\s+`?(?P<name>[a-zA-Z0-9_]+)`?\s*\("
    r"(?P<body>.*?)\)\s*ENGINE=(?P<engine>[a-zA-Z0-9_]+)\s+"
    r"DEFAULT\s+CHARSET=(?P<charset>[a-zA-Z0-9_]+)\s+"
    r"COLLATE=(?P<collation>[a-zA-Z0-9_]+)\s*;",
    re.IGNORECASE | re.DOTALL,
)
_COLUMN_TYPE_RE = re.compile(
    r"^(?P<type>[a-zA-Z]+(?:\([^)]*\))?(?:\s+unsigned)?)"
    r"(?=\s+(?:COLLATE|CHARACTER|NOT|NULL|DEFAULT|AUTO_INCREMENT|COMMENT|ON)\b|\s*$)",
    re.IGNORECASE,
)
_DEFAULT_RE = re.compile(
    r"\bDEFAULT\s+(?P<value>'(?:''|[^'])*'|\([^)]*\)|[^\s,]+)",
    re.IGNORECASE,
)
_TEXT_TYPES = {"char", "varchar", "tinytext", "text", "mediumtext", "longtext", "enum", "set"}


def _identifier_parts(fragment: str) -> tuple[list[str], list[int | None]]:
    parts = re.findall(r"`([^`]+)`(?:\((\d+)\))?", fragment)
    return (
        [name for name, _sub_part in parts],
        [int(sub_part) if sub_part else None for _name, sub_part in parts],
    )


def _identifier_list(fragment: str) -> list[str]:
    return _identifier_parts(fragment)[0]


def _base_type(column_type: str) -> str:
    return column_type.split("(", 1)[0].split()[0].lower()


def _parse_default(definition: str) -> str | None:
    match = _DEFAULT_RE.search(definition)
    if not match:
        return None
    value = match.group("value").strip()
    if value.upper() == "NULL":
        return None
    if value.startswith("'") and value.endswith("'"):
        return value[1:-1].replace("''", "'").replace("\\'", "'")
    return value


def _parse_column(line: str, *, charset: str, collation: str) -> tuple[str, dict[str, Any]]:
    name, definition = re.match(r"^`([^`]+)`\s+(.+)$", line).groups()  # type: ignore[union-attr]
    type_match = _COLUMN_TYPE_RE.match(definition)
    if not type_match:
        raise ValueError(f"Unsupported column definition: {line}")
    column_type = " ".join(type_match.group("type").lower().split())
    explicit_collation = re.search(r"\bCOLLATE\s+([a-zA-Z0-9_]+)", definition, re.IGNORECASE)
    is_text = _base_type(column_type) in _TEXT_TYPES
    return name, {
        "type": column_type,
        "nullable": "NOT NULL" not in definition.upper(),
        "default": _parse_default(definition),
        "auto_increment": "AUTO_INCREMENT" in definition.upper(),
        "charset": charset if is_text else None,
        "collation": (explicit_collation.group(1) if explicit_collation else collation) if is_text else None,
    }


def _parse_index(line: str) -> tuple[str, dict[str, Any]] | None:
    primary = re.match(r"^PRIMARY\s+KEY\s*\((?P<columns>.+)\)$", line, re.IGNORECASE)
    if primary:
        columns, sub_parts = _identifier_parts(primary.group("columns"))
        return "PRIMARY", {"unique": True, "columns": columns, "sub_parts": sub_parts}
    named = re.match(
        r"^(?P<unique>UNIQUE\s+)?KEY\s+`(?P<name>[^`]+)`\s*\((?P<columns>.+)\)$",
        line,
        re.IGNORECASE,
    )
    if not named:
        return None
    columns, sub_parts = _identifier_parts(named.group("columns"))
    return named.group("name"), {
        "unique": bool(named.group("unique")),
        "columns": columns,
        "sub_parts": sub_parts,
    }


def _parse_foreign_key(line: str) -> tuple[str, dict[str, Any]] | None:
    match = re.match(
        r"^CONSTRAINT\s+`(?P<name>[^`]+)`\s+FOREIGN\s+KEY\s*\((?P<columns>[^)]+)\)\s+"
        r"REFERENCES\s+`(?P<table>[^`]+)`\s*\((?P<referenced_columns>[^)]+)\)"
        r"(?P<rules>.*)$",
        line,
        re.IGNORECASE,
    )
    if not match:
        return None
    rules = match.group("rules")
    delete_match = re.search(r"\bON\s+DELETE\s+(RESTRICT|CASCADE|SET NULL|NO ACTION)", rules, re.IGNORECASE)
    update_match = re.search(r"\bON\s+UPDATE\s+(RESTRICT|CASCADE|SET NULL|NO ACTION)", rules, re.IGNORECASE)
    return match.group("name"), {
        "columns": _identifier_list(match.group("columns")),
        "referenced_table": match.group("table"),
        "referenced_columns": _identifier_list(match.group("referenced_columns")),
        "delete_rule": (delete_match.group(1) if delete_match else "RESTRICT").upper(),
        "update_rule": (update_match.group(1) if update_match else "RESTRICT").upper(),
    }


def build_contract(source: Path) -> dict[str, Any]:
    source_bytes = source.read_bytes()
    sql = source_bytes.decode("utf-8")
    tables: dict[str, Any] = {}
    for match in _CREATE_TABLE_RE.finditer(sql):
        table_name = match.group("name")
        charset = match.group("charset")
        collation = match.group("collation")
        columns: dict[str, Any] = {}
        indexes: dict[str, Any] = {}
        foreign_keys: dict[str, Any] = {}
        for raw_line in match.group("body").splitlines():
            line = raw_line.strip().rstrip(",")
            if not line or line.startswith("--"):
                continue
            if line.startswith("`"):
                name, column = _parse_column(line, charset=charset, collation=collation)
                columns[name] = column
                continue
            foreign_key = _parse_foreign_key(line)
            if foreign_key:
                foreign_keys[foreign_key[0]] = foreign_key[1]
                continue
            index = _parse_index(line)
            if index:
                indexes[index[0]] = index[1]
                continue
            raise ValueError(f"Unsupported table member in {table_name}: {line}")
        tables[table_name] = {
            "engine": match.group("engine"),
            "charset": charset,
            "collation": collation,
            "columns": columns,
            "indexes": indexes,
            "foreign_keys": foreign_keys,
        }
    conditional_foreign_key_re = re.compile(
        r"ALTER TABLE\s+`(?P<table>[^`]+)`\s+ADD\s+CONSTRAINT\s+`(?P<name>[^`]+)`\s+"
        r"FOREIGN\s+KEY\s*\((?P<columns>[^)]+)\)\s+REFERENCES\s+`(?P<referenced_table>[^`]+)`\s*"
        r"\((?P<referenced_columns>[^)]+)\)",
        re.IGNORECASE,
    )
    for foreign_key in conditional_foreign_key_re.finditer(sql):
        tables[foreign_key.group("table")]["foreign_keys"][foreign_key.group("name")] = {
            "columns": _identifier_list(foreign_key.group("columns")),
            "referenced_table": foreign_key.group("referenced_table"),
            "referenced_columns": _identifier_list(foreign_key.group("referenced_columns")),
            "delete_rule": "RESTRICT",
            "update_rule": "RESTRICT",
        }
    if len(tables) != 39:
        raise ValueError(f"Expected 39 baseline tables, parsed {len(tables)}")
    return {
        "contract_version": "V005",
        "source": str(source.relative_to(PROJECT_ROOT)).replace("\\", "/"),
        "source_sha256": hashlib.sha256(source_bytes).hexdigest(),
        "tables": dict(sorted(tables.items())),
    }


def render_contract(source: Path = DEFAULT_SOURCE) -> str:
    return json.dumps(build_contract(source), ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate the immutable runtime MySQL schema contract.")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--stdout", action="store_true")
    args = parser.parse_args(argv)
    rendered = render_contract(args.source.resolve())
    if args.stdout:
        print(rendered, end="")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
