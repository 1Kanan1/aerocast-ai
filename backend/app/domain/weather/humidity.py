"""Relative humidity derived from a report's own readings."""

from __future__ import annotations

import math

# Magnus coefficients over water. The same pair the card has always used.
_A = 17.625
_B = 243.04


def relative_humidity_pct(
    temperature_c: float | None, dewpoint_c: float | None
) -> int | None:
    """Whole percent of saturation, or None without both readings."""
    if temperature_c is None or dewpoint_c is None:
        return None

    relative = 100 * math.exp(
        (_A * dewpoint_c) / (_B + dewpoint_c)
        - (_A * temperature_c) / (_B + temperature_c)
    )
    return round(min(100.0, max(0.0, relative)))
