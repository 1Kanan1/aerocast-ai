"""Cache files into Postgres."""

from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import asdict
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from app.domain.metar import PARSER_VERSION as METAR_VERSION
from app.domain.metar import MetarParseError, classify, parse_metar
from app.domain.taf import PARSER_VERSION as TAF_VERSION
from app.domain.taf import TafParseError, parse_taf
from app.sources.awc import advisories, metars, pireps, stations, tafs
from app.sources.awc.cache import decompress, download, is_us

logger = logging.getLogger(__name__)

STATION_SQL = """
insert into stations (icao, name, state, country, lat, lon, elev_m)
values (:icao, :name, :state, :country, :lat, :lon, :elev_m)
on conflict (icao) do update set
    name = excluded.name,
    state = excluded.state,
    lat = excluded.lat,
    lon = excluded.lon,
    elev_m = excluded.elev_m
"""

METAR_SQL = """
insert into metar_observations (
    station_icao, obs_time, report_time, raw, decoded, category,
    upstream_category, parse_status, parser_version, fetched_at
) values (
    :station_icao, :obs_time, :report_time, :raw, cast(:decoded as jsonb),
    :category, :upstream_category, :parse_status, :parser_version, :fetched_at
)
on conflict (station_icao, obs_time) do update set
    decoded = excluded.decoded,
    category = excluded.category,
    upstream_category = excluded.upstream_category,
    parse_status = excluded.parse_status,
    parser_version = excluded.parser_version,
    fetched_at = excluded.fetched_at
"""

TAF_SQL = """
insert into taf_forecasts (
    station_icao, issue_time, valid_from, valid_to, raw, periods,
    parser_version, fetched_at
) values (
    :station_icao, :issue_time, :valid_from, :valid_to, :raw,
    cast(:periods as jsonb), :parser_version, :fetched_at
)
on conflict (station_icao, issue_time) do update set
    valid_from = excluded.valid_from,
    valid_to = excluded.valid_to,
    raw = excluded.raw,
    periods = excluded.periods,
    parser_version = excluded.parser_version,
    fetched_at = excluded.fetched_at
"""

RUN_SQL = """
insert into ingest_runs (
    job, started_at, finished_at, status, rows_upserted, error
) values (
    :job, :started_at, :finished_at, :status, :rows_upserted, :error
)
"""

ADVISORY_SQL = """
insert into advisories (
    kind, source_id, hazard, severity, base_ft, top_ft, due_to, raw,
    valid_from, valid_to, geom, fetched_at
) values (
    :kind, :source_id, :hazard, :severity, :base_ft, :top_ft, :due_to, :raw,
    :valid_from, :valid_to, cast(:geom as jsonb), :fetched_at
)
on conflict (kind, source_id, valid_from) do update set
    hazard = excluded.hazard,
    severity = excluded.severity,
    base_ft = excluded.base_ft,
    top_ft = excluded.top_ft,
    due_to = excluded.due_to,
    raw = excluded.raw,
    valid_to = excluded.valid_to,
    geom = excluded.geom,
    fetched_at = excluded.fetched_at
"""

PIREP_SQL = """
insert into pireps (
    report_time, station_icao, lat, lon, altitude_ft, kind,
    turbulence, icing, clouds, raw
) values (
    :report_time, :station_icao, :lat, :lon, :altitude_ft, :kind,
    :turbulence, :icing, :clouds, :raw
)
on conflict (report_time, lat, lon) do nothing
"""

Job = Callable[[AsyncConnection, datetime], Awaitable[int]]


def metar_record(
    row: metars.UpstreamMetar, fetched_at: datetime
) -> dict[str, object] | None:
    try:
        observation = parse_metar(row.raw, reference=row.observed_at)
    except MetarParseError:
        return None

    category = classify(observation).category
    return {
        "station_icao": row.station,
        "obs_time": row.observed_at,
        "report_time": None,
        "raw": row.raw,
        "decoded": json.dumps(observation.as_dict(), default=str),
        "category": category,
        "upstream_category": row.category,
        "parse_status": "mismatch"
        if row.category not in (None, category)
        else "ok",
        "parser_version": METAR_VERSION,
        "fetched_at": fetched_at,
    }


def taf_record(
    row: tafs.UpstreamTaf, fetched_at: datetime
) -> dict[str, object] | None:
    try:
        taf = parse_taf(row.raw, reference=row.issued_at)
    except TafParseError:
        return None

    return {
        "station_icao": taf.station,
        "issue_time": taf.issued_at,
        "valid_from": taf.valid_from,
        "valid_to": taf.valid_to,
        "raw": taf.raw,
        "periods": json.dumps(
            [asdict(period) for period in taf.periods], default=str
        ),
        "parser_version": TAF_VERSION,
        "fetched_at": fetched_at,
    }


async def ingest_stations(connection: AsyncConnection, _: datetime) -> int:
    payload = decompress(download(stations.CACHE_URL))
    records = [
        {
            "icao": station.icao,
            "name": station.name,
            "state": station.state,
            "country": station.country,
            "lat": station.lat,
            "lon": station.lon,
            "elev_m": station.elev_m,
        }
        for station in stations.read_stations(payload)
    ]
    await connection.execute(text(STATION_SQL), records)
    return len(records)


async def ingest_metars(connection: AsyncConnection, now: datetime) -> int:
    payload = decompress(download(metars.CACHE_URL))
    known = await _known_stations(connection)
    records = [
        record
        for row in metars.read_metars(payload)
        if is_us(row.station)
        and row.station in known
        and (record := metar_record(row, now)) is not None
    ]
    await connection.execute(text(METAR_SQL), records)
    return len(records)


async def ingest_tafs(connection: AsyncConnection, now: datetime) -> int:
    payload = decompress(download(tafs.CACHE_URL))
    known = await _known_stations(connection)
    records = [
        record
        for row in tafs.read_tafs(payload)
        if is_us(row.station)
        and row.station in known
        and (record := taf_record(row, now)) is not None
    ]
    await connection.execute(text(TAF_SQL), records)
    return len(records)


async def run_job(engine: AsyncEngine, name: str, job: Job) -> int:
    """Run one job under an advisory lock and record the attempt."""
    started = datetime.now(UTC)
    rows = 0
    status = "ok"
    error: str | None = None

    async with engine.connect() as connection:
        locked = await connection.scalar(
            text("select pg_try_advisory_lock(hashtext(:name))"),
            {"name": name},
        )
        if not locked:
            logger.info("%s is already running", name)
            return 0

        try:
            rows = await job(connection, started)
        except Exception as exc:  # noqa: BLE001 - recorded, then re-raised
            status, error = "error", f"{type(exc).__name__}: {exc}"[:500]
            logger.exception("%s failed", name)
        finally:
            await connection.execute(
                text("select pg_advisory_unlock(hashtext(:name))"),
                {"name": name},
            )

        await connection.execute(
            text(RUN_SQL),
            {
                "job": name,
                "started_at": started,
                "finished_at": datetime.now(UTC),
                "status": status,
                "rows_upserted": rows,
                "error": error,
            },
        )
        await connection.commit()

    return rows


async def ingest_advisories(connection: AsyncConnection, now: datetime) -> int:
    records = [
        {
            "kind": advisory.kind,
            "source_id": advisory.source_id,
            "hazard": advisory.hazard,
            "severity": advisory.severity,
            "base_ft": advisory.base_ft,
            "top_ft": advisory.top_ft,
            "due_to": advisory.due_to,
            "raw": advisory.raw,
            "valid_from": advisory.valid_from,
            "valid_to": advisory.valid_to,
            "geom": json.dumps(advisory.geometry),
            "fetched_at": now,
        }
        for advisory in (
            *advisories.read_gairmets(_get(advisories.GAIRMET_URL)),
            *advisories.read_sigmets(_get(advisories.SIGMET_URL)),
        )
    ]
    await connection.execute(text(ADVISORY_SQL), records)
    return len(records)


async def ingest_pireps(connection: AsyncConnection, _: datetime) -> int:
    records = [
        {
            "report_time": report.observed_at,
            "station_icao": report.station,
            "lat": report.lat,
            "lon": report.lon,
            "altitude_ft": report.altitude_ft,
            "kind": report.kind,
            "turbulence": report.turbulence,
            "icing": report.icing,
            "clouds": report.clouds,
            "raw": report.raw,
        }
        for report in pireps.read_pireps(_get(pireps.PIREP_URL))
    ]
    await connection.execute(text(PIREP_SQL), records)
    return len(records)


def _get(url: str) -> list[dict[str, object]]:
    payload = decompress(download(url))
    return [row for row in json.loads(payload) if isinstance(row, dict)]


async def _known_stations(connection: AsyncConnection) -> set[str]:
    result = await connection.execute(text("select icao from stations"))
    return {row[0] for row in result}


JOBS: tuple[tuple[str, int, Job], ...] = (
    ("stations", 24 * 60 * 60, ingest_stations),
    ("metars", 60, ingest_metars),
    ("tafs", 600, ingest_tafs),
    ("advisories", 300, ingest_advisories),
    ("pireps", 300, ingest_pireps),
)
