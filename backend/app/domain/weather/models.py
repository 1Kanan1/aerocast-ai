"""Value objects shared by METAR and TAF."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

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
    """Statute miles, keeping whether the value is a floor or a reading."""

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
    """Lowest broken, overcast or VV layer; report order is not trusted."""
    candidates = [
        layer
        for layer in layers
        if layer.cover in CEILING_COVERS and layer.base_ft is not None
    ]
    return (
        min(candidates, key=lambda layer: layer.base_ft or 0)
        if candidates
        else None
    )


def lowest_ceiling(layers: Sequence[CloudLayer]) -> int | None:
    layer = lowest_ceiling_layer(layers)
    return None if layer is None else layer.base_ft
