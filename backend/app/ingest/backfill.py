"""Load a station's recent history on first use.

uv run python -m app.ingest.backfill KSFO KSEA --hours 48
"""

from __future__ import annotations

import argparse
import asyncio
import json
from datetime import UTC, datetime

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

HISTORY_URL = (
    "https://aviationweather.gov/api/data/metar"
    "?format=json&ids={ids}&hours={hours}"
)

#: The API returns at most 400 rows, so a station's history is fetched in small
#: batches rather than one long list.
BATCH = 5


async def backfill(
    connection: AsyncConnection, stations: list[str], hours: int
) -> int:
    total = 0
    for index in range(0, len(stations), BATCH):
        total += await _load(
            connection, stations[index : index + BATCH], hours
        )
    return total


async def _load(
    connection: AsyncConnection, stations: list[str], hours: int
) -> int:
    payload = download(HISTORY_URL.format(ids=",".join(stations), hours=hours))
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
