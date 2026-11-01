"""AeroCast AI API.

FastAPI owns the database, the deterministic parsers, ingestion, and the only outbound
calls to AWC and the model providers. The Remix app is presentation plus a thin proxy.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import __version__
from app.api.health import router as health_router
from app.config import get_settings
from app.db.session import dispose_engine, ping

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s %(message)s",
)
logger = logging.getLogger("aerocast")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
    settings = get_settings()
    logger.info("starting AeroCast API %s (env=%s)", __version__, settings.aerocast_env)

    database_ok, database_error = await ping()
    if database_ok:
        logger.info("database connection ok")
    else:
        logger.error("database connection failed: %s", database_error)

    if not settings.zai_configured and not settings.gemini_configured:
        logger.warning("no remote model configured; /ask will rely on the local provider")
    if not settings.local_configured:
        logger.info("local model disabled (LOCAL_BASE_URL unset)")

    yield

    await dispose_engine()


def create_app() -> FastAPI:
    app = FastAPI(
        title="AeroCast AI",
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.include_router(health_router)
    return app


app = create_app()
