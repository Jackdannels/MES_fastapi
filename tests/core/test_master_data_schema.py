from pathlib import Path


SCHEMA_SQL = Path("scripts/sql/2026-03-17-mes-single-branch-schema-alignment.sql")


def test_schema_alignment_creates_master_data_tables_before_schedule_foreign_key():
    sql = SCHEMA_SQL.read_text(encoding="utf-8")

    test_type_position = sql.index("CREATE TABLE IF NOT EXISTS md_test_type")
    lab_position = sql.index("CREATE TABLE IF NOT EXISTS md_lab")
    schedule_position = sql.index("CREATE TABLE IF NOT EXISTS biz_schedule")

    assert test_type_position < lab_position < schedule_position
    assert "CONSTRAINT fk_md_lab_test_type FOREIGN KEY (test_type_id) REFERENCES md_test_type(test_type_id)" in sql
    assert "CONSTRAINT fk_biz_schedule_lab FOREIGN KEY (lab_id) REFERENCES md_lab(lab_id)" in sql
    assert "CALL add_column_if_missing('mes_single_branch', 'md_test_type', 'test_category'" in sql
    assert "CALL add_column_if_missing('mes_single_branch', 'md_lab', 'test_type_id'" in sql
    assert "CREATE PROCEDURE add_unique_index_if_missing" in sql
    assert "CALL add_unique_index_if_missing('mes_single_branch', 'md_test_type', 'uk_md_test_type_code'" in sql
    assert "CALL add_unique_index_if_missing('mes_single_branch', 'md_lab', 'uk_md_lab_code'" in sql
    assert "CALL add_index_if_missing('mes_single_branch', 'md_lab', 'idx_md_lab_test_type'" in sql


def test_schema_alignment_seeds_current_experiment_types_and_labs():
    sql = SCHEMA_SQL.read_text(encoding="utf-8")

    assert "INSERT INTO md_test_type" in sql
    assert "INSERT INTO md_lab" in sql
    assert "WHERE NOT EXISTS" in sql
    assert "'LAB_IMPACT_1' AS lab_code" in sql
    assert "'LAB_IMPACT' AS lab_code" not in sql
    assert "'YW', '盐雾试验'" in sql
    assert "'LAB_SALT', '盐雾试验室'" in sql
    assert "'LAB_IMPACT_1', '冲击一室'" in sql
    assert "'LAB_HOT_HUMID_2', '高低温湿热二室'" in sql
