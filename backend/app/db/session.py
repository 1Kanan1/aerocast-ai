"""Lazy async engine and session factory."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

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
        _session_factory = async_sessionmaker(
            get_engine(), expire_on_commit=False
        )
    return _session_factory


async def get_session() -> AsyncIterator[AsyncSession]:
    async with get_session_factory()() as session:
        yield session


async def fetch_all(
    sql: str, params: dict[str, object] | None = None
) -> list[dict[str, Any]]:
    async with get_session_factory()() as session:
        result = await session.execute(text(sql), params or {})
        return [dict(row) for row in result.mappings().all()]


async def fetch_one(
    sql: str, params: dict[str, object] | None = None
) -> dict[str, Any] | None:
    async with get_session_factory()() as session:
        result = await session.execute(text(sql), params or {})
        row = result.mappings().first()
        return dict(row) if row else None


async def ping() -> tuple[bool, str | None]:
    """Exception class name only: never echo connection details."""
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
