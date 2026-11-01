"""Value objects produced by the METAR parser.

Plain frozen dataclasses with no framework imports. The parsing layer has to stay boring:
every field here should be directly assertable in a test, and nothing should depend on a
web framework or a database driver to be exercised.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime

#: Inches of mercury per hectopascal.
HPA_PER_INHG = 33.8639


@dataclass(frozen=True, slots=True)
class Wind:
    direction_deg: int | None
    speed_kt: int | None
    gust_kt: int | None = None
    is_variable: bool = False
    variation_from_deg: int | None = None
    variation_to_deg: int | None = None
    raw: str = ""

    @property
    def is_calm(self) -> bool:
        return self.speed_kt == 0


@dataclass(frozen=True, slots=True)
class Visibility:
    """Statute miles, with the direction of the qualifier preserved.

    AWC reports "10+" for ten miles or more; the flag is what tells you the value is a
    floor rather than an exact reading.
    """

    statute_miles: float | None
    is_greater_than: bool = False
    is_less_than: bool = False
    raw: str = ""


@dataclass(frozen=True, slots=True)
class CloudLayer:
    cover: str  # FEW | SCT | BKN | OVC | VV
    base_ft: int | None
    cloud_type: str | None = None  # CB | TCU


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
        """Lowest broken, overcast, or vertical-visibility layer. None means no ceiling."""
        bases = [
            layer.base_ft
            for layer in self.clouds
            if layer.cover in {"BKN", "OVC", "VV"} and layer.base_ft is not None
        ]
        return min(bases) if bases else None

    @property
    def ceiling_layer(self) -> CloudLayer | None:
        candidates = [
            layer
            for layer in self.clouds
            if layer.cover in {"BKN", "OVC", "VV"} and layer.base_ft is not None
        ]
        return min(candidates, key=lambda layer: layer.base_ft or 0) if candidates else None

    @property
    def visibility_sm(self) -> float | None:
        return None if self.visibility is None else self.visibility.statute_miles

    def as_dict(self) -> dict[str, object]:
        return asdict(self)
