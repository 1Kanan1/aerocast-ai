from app.db.migrate import MIGRATIONS_DIR, statements


def test_statements_splits_and_drops_blanks() -> None:
    sql = "create table a (id int);\n\n  ;\ninsert into a values (1);"

    assert statements(sql) == [
        "create table a (id int)",
        "insert into a values (1)",
    ]


def test_every_migration_is_non_empty() -> None:
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))

    assert files, "no migrations found"
    for path in files:
        assert statements(path.read_text(encoding="utf-8"))


def test_migration_names_sort_in_apply_order() -> None:
    names = [path.name for path in sorted(MIGRATIONS_DIR.glob("*.sql"))]

    assert names == sorted(names)
