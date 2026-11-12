"""Station detail, history and map data."""

from __future__ import annotations

import math
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from shapely.geometry import Point, shape

from app.api import models
from app.api.envelope import METAR_STALE_SECONDS, wrap
from app.db.session import fetch_all, fetch_one
from app.domain.brief import BriefAdvisory, BriefStation, build_brief
from app.domain.geo import distance_nm
from app.domain.metar import (
    MetarParseError,
    Observation,
    parse_metar,
)
from app.domain.taf import Taf, TafParseError, parse_taf

router = APIRouter(prefix="/api", tags=["stations"])

STATION_COLUMNS = "icao, name, state, lat, lon, elev_m"

#: Degrees of latitude, near enough for a 50 nm search.
NM_PER_DEGREE = 60.0

#: How far a map click looks for stations to offer.
NEARBY_NM = 80.0


@router.get("/stations/near", response_model=models.NearbyStations)
async def near(
    lat: float = Query(ge=-90, le=90),
    lon: float = Query(ge=-180, le=180),
    limit: int = Query(default=5, ge=1, le=20),
) -> dict[str, Any]:
    """Stations within NEARBY_NM of a point, nearest first."""
    rows = await nearby_stations(lat, lon, NEARBY_NM, limit)
    return wrap(rows, source="awc stations")


async def nearby_stations(
    lat: float,
    lon: float,
    radius_nm: float,
    limit: int,
) -> list[dict[str, Any]]:
    """Stations inside a radius, nearest first, with their distance."""
    # A square in degrees is only a starting point: the list is chosen by the
    # real distance below. A degree of longitude is shorter away from the
    # equator, so the box has to widen with latitude or close stations east
    # and west fall outside it.
    pad_lat = radius_nm / NM_PER_DEGREE + 0.5
    pad_lon = pad_lat / max(0.05, math.cos(math.radians(lat)))

    rows = await fetch_all(
        f"select {STATION_COLUMNS} from stations "
        "where lat between :min_lat and :max_lat "
        "and lon between :min_lon and :max_lon",
        {
            "min_lat": lat - pad_lat,
            "max_lat": lat + pad_lat,
            "min_lon": lon - pad_lon,
            "max_lon": lon + pad_lon,
        },
    )

    found = [
        (distance_nm(lat, lon, row["lat"], row["lon"]), row) for row in rows
    ]
    found.sort(key=lambda item: item[0])
    inside = [
        {**row, "distance_nm": round(distance, 1)}
        for distance, row in found
        if distance <= radius_nm
    ]
    return inside[:limit]


@router.get("/stations", response_model=models.StationList)
async def search(
    q: str = Query(default=""),
    limit: int = Query(default=20, ge=1, le=100),
) -> dict[str, Any]:
    rows = await fetch_all(
        f"select {STATION_COLUMNS} from stations "
        "where icao ilike :pattern or name ilike :pattern "
        "order by icao limit :limit",
        {"pattern": f"%{q}%", "limit": limit},
    )
    return wrap(rows, source="awc stations")


@router.get("/stations/{icao}", response_model=models.StationDetailResponse)
async def detail(icao: str) -> dict[str, Any]:
    station = await fetch_one(
        f"select {STATION_COLUMNS} from stations where icao = :icao",
        {"icao": icao.upper()},
    )
    if station is None:
        raise HTTPException(status_code=404, detail="unknown station")

    observation = await _latest("metar_observations", "obs_time", icao)
    forecast = await _latest("taf_forecasts", "issue_time", icao)

    return wrap(
        {
            "station": station,
            "metar": observation,
            "taf": forecast,
            "advisories": await _nearby(station["lat"], station["lon"]),
        },
        source="aviationweather.gov",
        observed_at=observation["obs_time"] if observation else None,
        max_age_seconds=METAR_STALE_SECONDS,
    )


@router.get(
    "/stations/{icao}/observations",
    response_model=models.StationHistory,
)
async def observations(
    icao: str,
    hours: int = Query(default=48, ge=1, le=720),
) -> dict[str, Any]:
    rows = await fetch_all(
        "select obs_time, report_time, category, raw, decoded, "
        "parse_status, fetched_at from metar_observations "
        "where station_icao = :icao "
        "and obs_time > now() - make_interval(hours => :hours) "
        "order by obs_time desc",
        {"icao": icao.upper(), "hours": hours},
    )
    return wrap(
        rows,
        source="aviationweather.gov metars",
        observed_at=rows[0]["obs_time"] if rows else None,
        max_age_seconds=METAR_STALE_SECONDS,
    )


@router.get("/stations/{icao}/brief", response_model=models.StationBrief)
async def brief(icao: str) -> dict[str, Any]:
    """The fact bundle, and nothing the model inferred."""
    bundle, observation = await station_bundle(icao)

    return wrap(
        bundle,
        source="aviationweather.gov",
        observed_at=observation["obs_time"] if observation else None,
        fetched_at=observation["fetched_at"] if observation else None,
        max_age_seconds=METAR_STALE_SECONDS,
    )


async def station_bundle(
    icao: str,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Rebuild the bundle from stored raw text, for the brief and /ask.

    A bundle can never describe a newer or older parser than the one
    serving it.
    """
    station = await fetch_one(
        f"select {STATION_COLUMNS} from stations where icao = :icao",
        {"icao": icao.upper()},
    )
    if station is None:
        raise HTTPException(status_code=404, detail="unknown station")

    built, observation = await brief_station(station)
    bundle = build_brief([built], datetime.now(UTC))

    return bundle, observation


async def brief_station(
    station: dict[str, Any],
) -> tuple[BriefStation, dict[str, Any] | None]:
    """One station's report, forecast and nearby advisories, for a bundle."""
    icao = station["icao"]
    observation = await _latest("metar_observations", "obs_time", icao)
    forecast = await _latest("taf_forecasts", "issue_time", icao)
    nearby = await _nearby(station["lat"], station["lon"])

    return (
        BriefStation(
            icao=station["icao"],
            name=station["name"],
            lat=station["lat"],
            lon=station["lon"],
            observation=_observation(observation),
            taf=_taf(forecast),
            advisories=tuple(
                BriefAdvisory(
                    kind=row["kind"],
                    hazard=row["hazard"],
                    valid_to=row["valid_to"],
                    distance_nm=row["distance_nm"],
                    due_to=row["due_to"],
                )
                for row in nearby
            ),
        ),
        observation,
    )


@router.get("/map/layers", response_model=models.MapLayersResponse)
async def map_layers(
    bbox: str | None = Query(default=None),
) -> dict[str, Any]:
    """Advisory polygons for the viewport, and nothing else."""
    bounds = _bounds(bbox)

    advisories = await fetch_all(
        "select kind, hazard, source_id, geom from advisories "
        "where valid_to > now()"
    )

    return wrap(
        {
            "advisories": [
                {
                    "kind": row["kind"],
                    "hazard": row["hazard"],
                    "source_id": row["source_id"],
                    "geometry": row["geom"],
                }
                for row in advisories
                if _intersects(row["geom"], bounds)
            ],
        },
        source="aviationweather.gov",
    )


async def _latest(table: str, order: str, icao: str) -> Any:
    """Table and column are module literals, never user input."""
    return await fetch_one(
        f"select * from {table} where station_icao = :icao "
        f"order by {order} desc limit 1",
        {"icao": icao.upper()},
    )


def _observation(row: dict[str, Any] | None) -> Observation | None:
    """A row that no longer parses is a missing fact, not a 500."""
    if row is None:
        return None
    try:
        return parse_metar(row["raw"], reference=row["obs_time"])
    except MetarParseError:
        return None


def station_metar(
    station: dict[str, Any], row: dict[str, Any] | None
) -> dict[str, Any] | None:
    """One station's newest report in the bundle's own shape.

    Built without a forecast or advisories: a candidate list only needs the
    observation, and the bundle is the shape the client already formats.
    """
    observation = _observation(row)
    if observation is None:
        return None

    bundle = build_brief(
        [
            BriefStation(
                icao=station["icao"],
                name=station["name"],
                lat=station["lat"],
                lon=station["lon"],
                observation=observation,
            )
        ],
        datetime.now(UTC),
    )
    metar = bundle["stations"][0]["metar"]
    return metar if isinstance(metar, dict) else None


def _taf(row: dict[str, Any] | None) -> Taf | None:
    if row is None:
        return None
    try:
        return parse_taf(row["raw"], reference=row["issue_time"])
    except TafParseError:
        return None


def _bounds(value: str | None) -> tuple[float, float, float, float]:
    """min_lon, min_lat, max_lon, max_lat. The whole world when absent."""
    if not value:
        return (-180.0, -90.0, 180.0, 90.0)
    parts = [float(part) for part in value.split(",")]
    if len(parts) != 4:
        raise HTTPException(status_code=400, detail="bbox wants four numbers")
    return parts[0], parts[1], parts[2], parts[3]


def _intersects(
    geometry: dict[str, Any], bounds: tuple[float, float, float, float]
) -> bool:
    min_lon, min_lat, max_lon, max_lat = bounds
    west, south, east, north = shape(geometry).bounds
    return (
        east >= min_lon
        and west <= max_lon
        and north >= min_lat
        and south <= max_lat
    )


async def _nearby(
    lat: float, lon: float, radius_nm: float = 50.0
) -> list[dict[str, Any]]:
    rows = await fetch_all(
        "select kind, source_id, hazard, severity, base_ft, top_ft, "
        "due_to, valid_from, valid_to, geom from advisories "
        "where valid_to > now()"
    )

    point = Point(lon, lat)
    nearby: list[dict[str, Any]] = []
    for row in rows:
        distance = shape(row["geom"]).distance(point) * NM_PER_DEGREE
        if distance <= radius_nm:
            nearby.append({**row, "distance_nm": round(distance, 1)})

    return sorted(nearby, key=lambda item: item["distance_nm"])
