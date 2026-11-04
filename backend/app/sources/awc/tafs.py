"""Read TAFs out of AWC's bulk cache XML."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime

from app.sources.awc.cache import as_integer, as_number, as_timestamp

CACHE_URL = "https://aviationweather.gov/data/cache/tafs.cache.xml.gz"


@dataclass(frozen=True)
class UpstreamForecast:
    starts_at: datetime | None
    ends_at: datetime | None
    change: str
    wind_direction: int | None
    wind_speed: int | None
    visibility: float | None
    clouds: tuple[tuple[str, int | None], ...]


@dataclass(frozen=True)
class UpstreamTaf:
    raw: str
    station: str
    issued_at: datetime | None
    forecasts: tuple[UpstreamForecast, ...]


def read_tafs(text: str) -> Iterable[UpstreamTaf]:
    root = ET.fromstring(text)
    for element in root.iter("TAF"):
        yield UpstreamTaf(
            raw=element.findtext("raw_text", default=""),
            station=element.findtext("station_id", default=""),
            issued_at=as_timestamp(element.findtext("issue_time")),
            forecasts=tuple(
                _forecast(child) for child in element.findall("forecast")
            ),
        )


def _forecast(element: ET.Element) -> UpstreamForecast:
    return UpstreamForecast(
        starts_at=as_timestamp(element.findtext("fcst_time_from")),
        ends_at=as_timestamp(element.findtext("fcst_time_to")),
        change=element.findtext("change_indicator") or "INITIAL",
        wind_direction=as_integer(element.findtext("wind_dir_degrees")),
        wind_speed=as_integer(element.findtext("wind_speed_kt")),
        visibility=as_number(element.findtext("visibility_statute_mi")),
        clouds=tuple(
            (
                condition.get("sky_cover", ""),
                as_integer(condition.get("cloud_base_ft_agl")),
            )
            for condition in element.findall("sky_condition")
        ),
    )
