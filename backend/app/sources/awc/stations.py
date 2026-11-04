"""Read the AWC station list."""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass

CACHE_URL = "https://aviationweather.gov/data/cache/stations.cache.json.gz"


@dataclass(frozen=True)
class Station:
    icao: str
    name: str
    state: str | None
    country: str
    lat: float
    lon: float
    elev_m: int | None


def read_stations(text: str) -> Iterable[Station]:
    for row in json.loads(text):
        icao = (row.get("icaoId") or "").strip()
        if len(icao) != 4 or row.get("country") != "US":
            continue
        yield Station(
            icao=icao,
            name=(row.get("site") or icao).strip(),
            state=(row.get("state") or "").strip() or None,
            country="US",
            lat=float(row["lat"]),
            lon=float(row["lon"]),
            elev_m=row.get("elev"),
        )
