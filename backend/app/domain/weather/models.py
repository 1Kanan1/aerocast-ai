"""Value objects that describe weather conditions, independent of report type.

A METAR observation and a TAF forecast period describe the same things: wind, visibility,
cloud layers, present weather. Those live here so the two parsers share one definition and
one ceiling rule.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

#: Inches of mercury per hectopascal.
HPA_PER_INHG = 33.8639

CEILING_COVERS = frozenset({"BKN", "OVC", "VV"})


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


def lowest_ceiling_layer(layers: Sequence[CloudLayer]) -> CloudLayer | None:
    """The ceiling is the lowest broken, overcast, or vertical-visibility layer.

    Order in the report is not trusted: KS24 in the live cache lists BKN070 before OVC010,
    and the FAA definition is still 1,000 ft.
    """
    candidates = [
        layer for layer in layers if layer.cover in CEILING_COVERS and layer.base_ft is not None
    ]
    return min(candidates, key=lambda layer: layer.base_ft or 0) if candidates else None


def lowest_ceiling(layers: Sequence[CloudLayer]) -> int | None:
    layer = lowest_ceiling_layer(layers)
    return None if layer is None else layer.base_ft
