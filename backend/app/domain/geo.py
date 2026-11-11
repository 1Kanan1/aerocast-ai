"""Distance on the sphere, shared by the searches that rank stations."""

from __future__ import annotations

import math

EARTH_RADIUS_NM = 3440.065


def distance_nm(
    lat_a: float,
    lon_a: float,
    lat_b: float,
    lon_b: float,
) -> float:
    """Great-circle distance in nautical miles."""
    phi_a = math.radians(lat_a)
    phi_b = math.radians(lat_b)
    delta_phi = math.radians(lat_b - lat_a)
    delta_lambda = math.radians(lon_b - lon_a)
    hav = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi_a) * math.cos(phi_b) * math.sin(delta_lambda / 2) ** 2
    )
    return 2 * EARTH_RADIUS_NM * math.asin(math.sqrt(hav))
