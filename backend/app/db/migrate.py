"""Apply SQL migrations once each.

Alembic would bring a dependency and a generated environment for three tables.
The files here are plain SQL, applied in filename order and recorded in
`schema_migrations`.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.db.session import dispose_engine, get_engine

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"


def statements(sql: str) -> list[str]:
    """Split on semicolons. These files contain no procedural SQL."""
    return [part.strip() for part in sql.split(";") if part.strip()]


async def migrate(engine: AsyncEngine) -> list[str]:
    """Apply pending files and return the ones that ran."""
    applied: list[str] = []

    async with engine.begin() as connection:
        await connection.execute(
            text(
                "create table if not exists schema_migrations ("
                "name text primary key, "
                "applied_at timestamptz not null default now())"
            )
        )
        done = {
            row[0]
            for row in await connection.execute(
                text("select name from schema_migrations")
            )
        }

        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if path.name in done:
                continue
            for statement in statements(path.read_text(encoding="utf-8")):
                await connection.execute(text(statement))
            await connection.execute(
                text("insert into schema_migrations (name) values (:name)"),
                {"name": path.name},
            )
            applied.append(path.name)

    return applied


async def _main() -> None:
    logging.basicConfig(level=logging.INFO)
    applied = await migrate(get_engine())
    for name in applied:
        logger.info("applied %s", name)
    if not applied:
        logger.info("schema is up to date")
    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(_main())
