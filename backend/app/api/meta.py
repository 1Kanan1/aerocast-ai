"""Provenance and freshness, so the UI can say where data came from."""

from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from app.db.session import get_session_factory
from app.sources.awc import advisories, metars, stations, tafs

router = APIRouter(tags=["system"])

TABLES = (
    "stations",
    "metar_observations",
    "taf_forecasts",
    "advisories",
    "pireps",
)


@router.get("/api/meta")
async def meta() -> dict[str, object]:
    async with get_session_factory()() as session:
        counts = {
            table: await session.scalar(text(f"select count(*) from {table}"))
            for table in TABLES
        }
        runs = (
            (
                await session.execute(
                    text(
                        "select distinct on (job) job, status, rows_upserted, "
                        "started_at, finished_at, error from ingest_runs "
                        "order by job, id desc"
                    )
                )
            )
            .mappings()
            .all()
        )

    return {
        "counts": counts,
        "jobs": [dict(row) for row in runs],
        "sources": {
            "metars": metars.CACHE_URL,
            "tafs": tafs.CACHE_URL,
            "stations": stations.CACHE_URL,
            "gairmets": advisories.GAIRMET_URL,
            "sigmets": advisories.SIGMET_URL,
            "pireps": "https://aviationweather.gov/api/data/pirep",
        },
    }
