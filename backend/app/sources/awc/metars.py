"""Read METARs out of AWC's bulk cache CSV."""

from __future__ import annotations

import csv
import io
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime

from app.sources.awc.cache import as_integer, as_number, as_timestamp

CACHE_URL = "https://aviationweather.gov/data/cache/metars.cache.csv.gz"

CLEAR_SKY = frozenset({"SKC", "CLR", "NSC", "NCD"})


@dataclass(frozen=True)
class UpstreamMetar:
    raw: str
    station: str
    observed_at: datetime
    temperature: float | None
    dewpoint: float | None
    wind_direction: int | None
    wind_speed: int | None
    wind_gust: int | None
    visibility: float | None
    altimeter: float | None
    clouds: tuple[tuple[str, int | None], ...]
    category: str | None


def read_metars(text: str) -> Iterable[UpstreamMetar]:
    reader = csv.reader(io.StringIO(text))
    index = _column_index(next(reader))

    cloud_slots = [
        (cover_position, index["cloud_base_ft_agl"][slot])
        for slot, cover_position in enumerate(index["sky_cover"])
    ]

    for values in reader:
        raw_position = index["raw_text"][0]
        if len(values) <= raw_position:
            continue
        if not values[raw_position].startswith(("METAR", "SPECI")):
            continue

        observed_at = as_timestamp(_cell(values, index["observation_time"][0]))
        if observed_at is None:
            continue

        clouds: list[tuple[str, int | None]] = []
        for cover_position, base_position in cloud_slots:
            cover = _cell(values, cover_position)
            if cover:
                clouds.append(
                    (
                        _normalize_cover(cover),
                        as_integer(_cell(values, base_position)),
                    )
                )

        yield UpstreamMetar(
            raw=values[raw_position],
            station=_cell(values, index["station_id"][0]) or "",
            observed_at=observed_at,
            temperature=as_number(_cell(values, index["temp_c"][0])),
            dewpoint=as_number(_cell(values, index["dewpoint_c"][0])),
            wind_direction=as_integer(
                _cell(values, index["wind_dir_degrees"][0])
            ),
            wind_speed=as_integer(_cell(values, index["wind_speed_kt"][0])),
            wind_gust=as_integer(_cell(values, index["wind_gust_kt"][0])),
            visibility=as_number(
                _cell(values, index["visibility_statute_mi"][0])
            ),
            altimeter=as_number(_cell(values, index["altim_in_hg"][0])),
            clouds=tuple(clouds),
            category=_cell(values, index["flight_category"][0]),
        )


def _column_index(header: list[str]) -> dict[str, list[int]]:
    index: dict[str, list[int]] = defaultdict(list)
    for position, name in enumerate(header):
        index[name].append(position)
    for required in ("raw_text", "station_id", "observation_time"):
        if required not in index:
            raise ValueError(f"unexpected cache format: no {required!r}")
    return index


def _cell(values: Sequence[str], position: int) -> str | None:
    if position >= len(values):
        return None
    value = values[position].strip()
    if not value or value.lower() in {"null", "none", "n/a"}:
        return None
    return value


def _normalize_cover(cover: str) -> str:
    """The cache writes vertical visibility as `OVX`; the report says `VV`."""
    return "VV" if cover == "OVX" else cover
