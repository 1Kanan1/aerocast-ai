"""Read G-AIRMET and SIGMET polygons."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

GAIRMET_URL = "https://aviationweather.gov/api/data/gairmet?format=json"
SIGMET_URL = "https://aviationweather.gov/api/data/isigmet?format=json"


@dataclass(frozen=True)
class Advisory:
    source_id: str
    kind: str
    hazard: str
    severity: str | None
    base_ft: int | None
    top_ft: int | None
    due_to: str | None
    raw: str | None
    valid_from: datetime
    valid_to: datetime
    geometry: dict[str, object]


def read_gairmets(rows: Sequence[dict[str, object]]) -> Iterable[Advisory]:
    for row in rows:
        starts = _moment(row.get("validTime"))
        ends = _moment(row.get("expireTime"))
        geometry = _polygon(row.get("coords"), row.get("geom"))
        if starts is None or ends is None or geometry is None:
            continue
        yield Advisory(
            source_id=f"{row.get('product')}:{row.get('tag')}",
            kind="gairmet",
            hazard=str(row.get("hazard") or "UNKNOWN"),
            severity=_text(row.get("severity")),
            base_ft=_int(row.get("base")),
            top_ft=_int(row.get("top")),
            due_to=_text(row.get("due_to")),
            raw=None,
            valid_from=starts,
            valid_to=ends,
            geometry=geometry,
        )


def read_sigmets(rows: Sequence[dict[str, object]]) -> Iterable[Advisory]:
    for row in rows:
        starts = _moment(row.get("validTimeFrom"))
        ends = _moment(row.get("validTimeTo"))
        geometry = _polygon(row.get("coords"), row.get("geom"))
        if starts is None or ends is None or geometry is None:
            continue
        yield Advisory(
            source_id=f"{row.get('firId')}:{row.get('seriesId')}",
            kind="sigmet",
            hazard=str(row.get("hazard") or "UNKNOWN"),
            severity=_text(row.get("qualifier")),
            base_ft=_int(row.get("base")),
            top_ft=_int(row.get("top")),
            due_to=_text(row.get("qualifier")),
            raw=_text(row.get("rawSigmet")),
            valid_from=starts,
            valid_to=ends,
            geometry=geometry,
        )


def _polygon(coords: object, geom: object) -> dict[str, object] | None:
    if not isinstance(coords, list) or len(coords) < 2:
        return None
    points = [
        [float(point["lon"]), float(point["lat"])]
        for point in coords
        if isinstance(point, dict) and "lat" in point and "lon" in point
    ]
    if len(points) < 2:
        return None

    if geom == "LINE":
        return {"type": "LineString", "coordinates": points}

    ring = points if points[0] == points[-1] else [*points, points[0]]
    return {"type": "Polygon", "coordinates": [ring]}


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


def _text(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None
