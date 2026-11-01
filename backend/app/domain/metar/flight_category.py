"""Flight category.

FAA definitions, applied deterministically:

| Category | Ceiling          | Visibility |
|----------|------------------|------------|
| VFR      | greater than 3000 | greater than 5 |
| MVFR     | 1000 to 3000     | 3 to 5     |
| IFR      | 500 to under 1000 | 1 to under 3 |
| LIFR     | under 500        | under 1    |

The worse of ceiling and visibility wins. Boundaries are inclusive at the bottom of each
band: a 3000 ft ceiling is MVFR, a 1000 ft ceiling is MVFR, a 500 ft ceiling is IFR.
That is the definition AWC uses, which matters because the cross-check harness measures
us against it.

Visibility is required. A report with no visibility group cannot be classified, because
"ceiling unlimited" only resolves half the definition, and returning a category anyway
would be a judgement about conditions nobody measured. This matches AWC, which publishes
no flight category for those reports.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.domain.metar.models import Observation

VFR = "VFR"
MVFR = "MVFR"
IFR = "IFR"
LIFR = "LIFR"

CATEGORY_ORDER = (VFR, MVFR, IFR, LIFR)

#: Cloud cover codes read as words in the basis string, because that string is quoted
#: verbatim by the brief and by anything the model is allowed to say.
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
    """Classify a parsed observation and explain the reasoning in one line.

    The basis string is what the brief shows and what the model is allowed to quote, so
    it is generated here rather than assembled downstream.
    """
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
