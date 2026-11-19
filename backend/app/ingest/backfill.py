"""Load a station's recent history on first use.

uv run python -m app.ingest.backfill KSFO KSEA --hours 48
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.db.session import dispose_engine, get_engine
from app.domain.metar import (
    PARSER_VERSION,
    MetarParseError,
    classify,
    parse_metar,
)
from app.ingest.jobs import METAR_SQL
from app.sources.awc.cache import as_timestamp, download

logger = logging.getLogger(__name__)

HISTORY_URL = (
    "https://aviationweather.gov/api/data/metar"
    "?format=json&ids={ids}&hours={hours}"
)

#: The API returns at most 400 rows, so a station's history is fetched in small
#: batches rather than one long list.
BATCH = 5

#: How much history a station gets the first time its timeline is read.
HISTORY_HOURS = 48

#: A station whose last day carries fewer reports than this has hours the
#: timeline cannot fill, so it is refilled the first time someone asks.
THIN_HOURS = 24
THIN_MINIMUM = 12

Loader = Callable[[str], Awaitable[None]]
Clock = Callable[[], float]

#: One station, one request: the reader is waiting, so no retries and a short
#: leash. A cold station is rare; a slow upstream must not hold the page.
ON_DEMAND_ATTEMPTS = 1
ON_DEMAND_TIMEOUT = 6.0
LOAD_TIMEOUT = 8.0

#: A station that just failed is left alone for this long, so a dead upstream
#: does not add its timeout to every request.
RETRY_SECONDS = 600

_attempted: dict[str, float] = {}


def needs_history(rows: Sequence[Mapping[str, Any]], now: datetime) -> bool:
    """True when the last day has too few reports to draw every hour."""
    since = now - timedelta(hours=THIN_HOURS)
    recent = sum(1 for row in rows if row["obs_time"] > since)
    return recent < THIN_MINIMUM


async def ensure_history(
    icao: str,
    rows: Sequence[Mapping[str, Any]],
    hours: int,
    *,
    now: datetime | None = None,
    clock: Clock = time.monotonic,
    loader: Loader | None = None,
) -> bool:
    """Fill a station's missing history before answering its timeline.

    Returns True when new rows were loaded. Failures are logged and ignored:
    the caller still has whatever the database already holds.
    """
    if hours < THIN_HOURS:
        return False
    if not needs_history(rows, now or datetime.now(UTC)):
        return False

    last = _attempted.get(icao)
    if last is not None and clock() - last < RETRY_SECONDS:
        return False
    _attempted[icao] = clock()

    try:
        await asyncio.wait_for((loader or _load_one)(icao), LOAD_TIMEOUT)
    except Exception:  # noqa: BLE001 - the local rows still answer
        logger.warning("history backfill failed for %s", icao, exc_info=True)
        return False
    return True


async def _load_one(icao: str) -> None:
    engine = get_engine()
    async with engine.connect() as connection:
        await backfill(
            connection,
            [icao],
            HISTORY_HOURS,
            attempts=ON_DEMAND_ATTEMPTS,
            timeout=ON_DEMAND_TIMEOUT,
        )
        await connection.commit()


async def backfill(
    connection: AsyncConnection,
    stations: list[str],
    hours: int,
    *,
    attempts: int = 3,
    timeout: float = 60.0,
) -> int:
    total = 0
    for index in range(0, len(stations), BATCH):
        total += await _load_batch(
            connection,
            stations[index : index + BATCH],
            hours,
            attempts=attempts,
            timeout=timeout,
        )
    return total


async def _load_batch(
    connection: AsyncConnection,
    stations: list[str],
    hours: int,
    *,
    attempts: int,
    timeout: float,
) -> int:
    payload = await asyncio.to_thread(
        download,
        HISTORY_URL.format(ids=",".join(stations), hours=hours),
        attempts,
        timeout,
    )
    now = datetime.now(UTC)
    records = []

    for row in json.loads(payload):
        observed_at = as_timestamp(row.get("reportTime"))
        raw = row.get("rawOb")
        if observed_at is None or not raw:
            continue
        try:
            observation = parse_metar(raw, reference=observed_at)
        except MetarParseError:
            continue
        category = classify(observation).category
        records.append(
            {
                "station_icao": observation.station,
                "obs_time": observation.observed_at,
                "report_time": observed_at,
                "raw": raw,
                "decoded": json.dumps(observation.as_dict(), default=str),
                "category": category,
                "upstream_category": row.get("fltCat"),
                "parse_status": "ok"
                if row.get("fltCat") in (None, category)
                else "mismatch",
                "parser_version": PARSER_VERSION,
                "fetched_at": now,
            }
        )

    if records:
        await connection.execute(text(METAR_SQL), records)
    return len(records)


async def _main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stations", nargs="+")
    parser.add_argument("--hours", type=int, default=48)
    args = parser.parse_args()

    engine = get_engine()
    async with engine.connect() as connection:
        rows = await backfill(connection, args.stations, args.hours)
        await connection.commit()
    print(f"{rows} observations")
    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(_main())
