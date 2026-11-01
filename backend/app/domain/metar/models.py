"""A parsed METAR or SPECI observation."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime

from app.domain.weather.models import (
    HPA_PER_INHG,
    CloudLayer,
    Visibility,
    Wind,
    lowest_ceiling,
    lowest_ceiling_layer,
)

__all__ = [
    "CloudLayer",
    "Observation",
    "Visibility",
    "Wind",
]


@dataclass(frozen=True, slots=True)
class Observation:
    station: str
    report_type: str
    observed_at: datetime
    raw: str
    is_automated: bool = False
    is_corrected: bool = False
    wind: Wind | None = None
    visibility: Visibility | None = None
    weather: tuple[str, ...] = ()
    clouds: tuple[CloudLayer, ...] = ()
    temperature_c: float | None = None
    dewpoint_c: float | None = None
    altimeter_in_hg: float | None = None
    is_cavok: bool = False
    remarks: str | None = None
    unparsed: tuple[str, ...] = ()

    @property
    def altimeter_hpa(self) -> float | None:
        """AWC reports altimeter in hectopascals, so both units are exposed."""
        if self.altimeter_in_hg is None:
            return None
        return round(self.altimeter_in_hg * HPA_PER_INHG, 1)

    @property
    def ceiling_ft(self) -> int | None:
        return lowest_ceiling(self.clouds)

    @property
    def ceiling_layer(self) -> CloudLayer | None:
        return lowest_ceiling_layer(self.clouds)

    @property
    def visibility_sm(self) -> float | None:
        return None if self.visibility is None else self.visibility.statute_miles

    def as_dict(self) -> dict[str, object]:
        return asdict(self)
