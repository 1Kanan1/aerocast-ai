"""Database engine and session plumbing.

The engine is created lazily, so importing this module never opens a connection.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import get_settings

logger = logging.getLogger(__name__)

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_async_engine(
            get_settings().database_url,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=5,
        )
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    return _session_factory


async def get_session() -> AsyncIterator[AsyncSession]:
    async with get_session_factory()() as session:
        yield session


async def ping() -> tuple[bool, str | None]:
    """Cheap liveness check for /api/health.

    Returns the exception class name, never the message, so a driver error cannot
    echo connection details into a response.
    """
    try:
        async with get_engine().connect() as connection:
            await connection.execute(text("select 1"))
    except Exception as exc:  # noqa: BLE001 - any failure means "not usable"
        logger.warning("database ping failed", exc_info=exc)
        return False, type(exc).__name__
    return True, None


async def dispose_engine() -> None:
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None
