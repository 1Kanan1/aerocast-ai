"""AeroCast AI API. Owns the database, parsers and model calls."""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import __version__
from app.api.health import router as health_router
from app.api.meta import router as meta_router
from app.api.stations import router as stations_router
from app.api.weather import router as weather_router
from app.config import get_settings
from app.db.migrate import upgrade_async
from app.db.session import dispose_engine, get_engine, ping
from app.ingest import scheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s %(message)s",
)
logger = logging.getLogger("aerocast")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
    settings = get_settings()
    logger.info(
        "starting AeroCast API %s (env=%s)", __version__, settings.aerocast_env
    )

    database_ok, database_error = await ping()
    if database_ok:
        logger.info("database connection ok")
        await upgrade_async()
    else:
        logger.error("database connection failed: %s", database_error)

    if not settings.zai_configured and not settings.gemini_configured:
        logger.warning(
            "no remote model configured; /ask will rely on the local provider"
        )
    if not settings.local_configured:
        logger.info("local model disabled (LOCAL_BASE_URL unset)")

    async with scheduler.running(get_engine()):
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
    app.include_router(meta_router)
    app.include_router(stations_router)
    app.include_router(weather_router)
    return app


app = create_app()
