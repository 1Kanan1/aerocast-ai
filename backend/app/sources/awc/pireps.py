"""Read pilot reports."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

#: The PIREP endpoint requires a bounding box; this is the CONUS one.
PIREP_URL = (
    "https://aviationweather.gov/api/data/pirep"
    "?format=json&bbox=24,-125,50,-66&age=3"
)


@dataclass(frozen=True)
class Pirep:
    station: str | None
    observed_at: datetime
    lat: float
    lon: float
    altitude_ft: int | None
    kind: str | None
    turbulence: str | None
    icing: str | None
    clouds: str | None
    raw: str


def read_pireps(rows: Sequence[dict[str, object]]) -> Iterable[Pirep]:
    for row in rows:
        observed_at = _moment(row.get("obsTime"))
        lat = _float(row.get("lat"))
        lon = _float(row.get("lon"))
        raw = row.get("rawOb")
        if observed_at is None or lat is None or lon is None or not raw:
            continue
        yield Pirep(
            station=_text(row.get("icaoId")),
            observed_at=observed_at,
            lat=lat,
            lon=lon,
            altitude_ft=_int(row.get("fltLvl")),
            kind=_text(row.get("pirepType")),
            turbulence=_summary(row, "tb"),
            icing=_summary(row, "icg"),
            clouds=_clouds(row.get("clouds")),
            raw=str(raw),
        )


def _summary(row: dict[str, object], prefix: str) -> str | None:
    intensity = _text(row.get(f"{prefix}Int1"))
    kind = _text(row.get(f"{prefix}Type1"))
    base = _int(row.get(f"{prefix}Bas1"))
    top = _int(row.get(f"{prefix}Top1"))
    if not (intensity or kind):
        return None
    span = f" {base}-{top}" if base is not None or top is not None else ""
    return f"{kind or ''}{intensity or ''}{span}".strip()


def _clouds(value: object) -> str | None:
    if not isinstance(value, list):
        return None
    parts = [
        f"{layer.get('cover')}{layer.get('base')}"
        for layer in value
        if isinstance(layer, dict)
    ]
    return " ".join(parts) or None


def _moment(value: object) -> datetime | None:
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, UTC)
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _int(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _float(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _text(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None
