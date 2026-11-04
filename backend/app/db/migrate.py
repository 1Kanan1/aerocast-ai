"""Run Alembic upgrades from the application."""

from __future__ import annotations

import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config

BACKEND_ROOT = Path(__file__).resolve().parents[2]
ALEMBIC_INI = BACKEND_ROOT / "alembic.ini"


def upgrade(revision: str = "head") -> None:
    command.upgrade(Config(str(ALEMBIC_INI)), revision)


async def upgrade_async(revision: str = "head") -> None:
    """migrations/env.py runs its own loop, so offload it to a thread."""
    await asyncio.to_thread(upgrade, revision)
