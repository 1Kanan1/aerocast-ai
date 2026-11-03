"""Flight category, FAA definitions.

| Category | Ceiling        | Visibility |
|----------|----------------|------------|
| VFR      | > 3,000 ft     | > 5 SM     |
| MVFR     | 1,000-3,000 ft | 3-5 SM     |
| IFR      | 500-<1,000 ft  | 1-<3 SM    |
| LIFR     | < 500 ft       | < 1 SM     |

Worst of the two wins. Visibility is required: without it only half the definition is
known, so the category is null, as AWC also publishes.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.domain.metar.models import Observation

VFR = "VFR"
MVFR = "MVFR"
IFR = "IFR"
LIFR = "LIFR"

COVER_WORDS = {
    "FEW": "few",
    "SCT": "scattered",
    "BKN": "broken",
    "OVC": "overcast",
    "VV": "vertical visibility",
}


@dataclass(frozen=True, slots=True)
class FlightCategory:
    category: str | None
    ceiling_ft: int | None
    visibility_sm: float | None
    basis: str

    def as_dict(self) -> dict[str, object]:
        return {
            "category": self.category,
            "ceiling_ft": self.ceiling_ft,
            "visibility_sm": self.visibility_sm,
            "basis": self.basis,
        }


def category_for(ceiling_ft: int | None, visibility_sm: float | None) -> str | None:
    """Return the category, or None when visibility is unknown."""
    if visibility_sm is None:
        return None

    low_ceiling = ceiling_ft is not None and ceiling_ft < 500
    low_visibility = visibility_sm is not None and visibility_sm < 1
    if low_ceiling or low_visibility:
        return LIFR

    marginal_ceiling = ceiling_ft is not None and ceiling_ft < 1000
    marginal_visibility = visibility_sm is not None and visibility_sm < 3
    if marginal_ceiling or marginal_visibility:
        return IFR

    ceiling_band = ceiling_ft is not None and ceiling_ft <= 3000
    visibility_band = visibility_sm is not None and visibility_sm <= 5
    if ceiling_band or visibility_band:
        return MVFR

    return VFR


def classify(observation: Observation) -> FlightCategory:
    """Category plus the basis string the brief and the model may quote."""
    ceiling_ft = observation.ceiling_ft
    visibility_sm = observation.visibility_sm
    category = category_for(ceiling_ft, visibility_sm)

    parts: list[str] = []

    layer = observation.ceiling_layer
    if layer is not None and layer.base_ft is not None:
        cover = COVER_WORDS.get(layer.cover, layer.cover.lower())
        parts.append(f"ceiling {layer.base_ft:,} ft {cover}")
    else:
        parts.append("no ceiling")

    if observation.visibility is not None:
        vis = observation.visibility
        if vis.statute_miles is not None:
            if vis.is_greater_than:
                qualifier = "more than "
            elif vis.is_less_than:
                qualifier = "less than "
            else:
                qualifier = ""
            parts.append(f"visibility {qualifier}{vis.statute_miles:g} SM")
    if observation.is_cavok:
        parts.append("CAVOK")

    return FlightCategory(
        category=category,
        ceiling_ft=ceiling_ft,
        visibility_sm=visibility_sm,
        basis=", ".join(parts),
    )
