"""Token grammar shared by METAR and TAF."""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field

from app.domain.weather.models import CloudLayer, Visibility, Wind

METRES_PER_STATUTE_MILE = 1609.344
KNOTS_PER_METRE_PER_SECOND = 1.943844
KNOTS_PER_KM_PER_HOUR = 0.539957

#: CAVOK: 10 km or more, no cloud below 5,000 ft, no CB/TCU, no significant weather.
CAVOK_STATUTE_MILES = round(10_000 / METRES_PER_STATUTE_MILE, 2)

WIND = re.compile(
    r"^(?P<direction>\d{3}|VRB)(?P<speed>\d{2,3})(?:G(?P<gust>\d{2,3}))?(?P<unit>KT|MPS|KMH)$"
)
WIND_VARIATION = re.compile(r"^(?P<start>\d{3})V(?P<end>\d{3})$")
CLOUD = re.compile(r"^(?P<cover>FEW|SCT|BKN|OVC)(?P<base>\d{3}|///)(?P<type>CB|TCU|///)?$")
VERTICAL_VISIBILITY = re.compile(r"^VV(?P<base>\d{3}|///)$")
VISIBILITY_SM = re.compile(
    r"^(?P<lead>[MP])?(?P<whole>\d{1,2})?"
    r"(?:(?P<numerator>\d{1,2})/(?P<denominator>\d{1,2}))?SM$"
)
VISIBILITY_FRACTION = re.compile(r"^(?P<numerator>\d{1,2})/(?P<denominator>\d{1,2})SM$")
VISIBILITY_METRES = re.compile(r"^(?P<metres>\d{4})(?:NDV)?$")
WHOLE_NUMBER = re.compile(r"^\d{1,2}$")

SKY_CLEAR = frozenset({"SKC", "CLR", "NSC", "NCD"})

#: Two-letter weather codes. A token is weather if it decomposes entirely into these.
WEATHER_CODES = frozenset(
    {
        # qualifiers
        "MI", "PR", "BC", "DR", "BL", "SH", "TS", "FZ",
        # precipitation
        "DZ", "RA", "SN", "SG", "IC", "PL", "GR", "GS", "UP",
        # obscuration
        "BR", "FG", "FU", "VA", "DU", "SA", "HZ", "PY",
        # other
        "PO", "SQ", "FC", "SS", "DS",
    }
)


@dataclass
class Conditions:
    """Mutable accumulator used while scanning a group of tokens."""

    wind: Wind | None = None
    visibility: Visibility | None = None
    weather: list[str] = field(default_factory=list)
    clouds: list[CloudLayer] = field(default_factory=list)
    is_cavok: bool = False
    unparsed: list[str] = field(default_factory=list)

    @property
    def visibility_sm(self) -> float | None:
        return None if self.visibility is None else self.visibility.statute_miles


def scan_conditions(tokens: Sequence[str]) -> Conditions:
    """Consume wind, visibility, cloud and weather groups. Everything else is unparsed."""
    conditions = Conditions()
    index = 0

    while index < len(tokens):
        token = tokens[index]

        if token == "CAVOK":
            conditions.is_cavok = True
            conditions.visibility = Visibility(
                statute_miles=CAVOK_STATUTE_MILES,
                is_greater_than=True,
                raw=token,
            )
            index += 1
            continue

        if conditions.wind is None:
            match = WIND.match(token)
            if match is not None:
                conditions.wind = build_wind(match, token)
                index += 1
                continue

        if conditions.wind is not None:
            match = WIND_VARIATION.match(token)
            if match is not None:
                conditions.wind = with_variation(
                    conditions.wind, int(match["start"]), int(match["end"])
                )
                index += 1
                continue

        if conditions.visibility is None:
            parsed = take_visibility(tokens, index)
            if parsed is not None:
                conditions.visibility, consumed = parsed
                index += consumed
                continue

        match = CLOUD.match(token)
        if match is not None:
            conditions.clouds.append(build_cloud(match))
            index += 1
            continue

        match = VERTICAL_VISIBILITY.match(token)
        if match is not None:
            conditions.clouds.append(build_vertical_visibility(match))
            index += 1
            continue

        if token in SKY_CLEAR:
            index += 1
            continue

        if is_weather(token):
            conditions.weather.append(token)
            index += 1
            continue

        if set(token) == {"/"}:
            index += 1
            continue

        conditions.unparsed.append(token)
        index += 1

    return conditions


def build_wind(match: re.Match[str], token: str) -> Wind:
    direction_raw = match["direction"]
    speed = int(match["speed"])
    gust = int(match["gust"]) if match["gust"] else None

    unit = match["unit"]
    if unit == "MPS":
        speed = round(speed * KNOTS_PER_METRE_PER_SECOND)
        gust = round(gust * KNOTS_PER_METRE_PER_SECOND) if gust is not None else None
    elif unit == "KMH":
        speed = round(speed * KNOTS_PER_KM_PER_HOUR)
        gust = round(gust * KNOTS_PER_KM_PER_HOUR) if gust is not None else None

    return Wind(
        direction_deg=None if direction_raw == "VRB" else int(direction_raw),
        speed_kt=speed,
        gust_kt=gust,
        is_variable=direction_raw == "VRB",
        raw=token,
    )


def with_variation(wind: Wind, start: int, end: int) -> Wind:
    return Wind(
        direction_deg=wind.direction_deg,
        speed_kt=wind.speed_kt,
        gust_kt=wind.gust_kt,
        is_variable=wind.is_variable,
        variation_from_deg=start,
        variation_to_deg=end,
        raw=f"{wind.raw} {start:03d}V{end:03d}",
    )


def take_visibility(tokens: Sequence[str], index: int) -> tuple[Visibility, int] | None:
    """Read a visibility group, returning it and how many tokens it consumed."""
    token = tokens[index]

    # "1 1/2SM" arrives as two tokens.
    if WHOLE_NUMBER.match(token) and index + 1 < len(tokens):
        fraction = VISIBILITY_FRACTION.match(tokens[index + 1])
        if fraction is not None:
            denominator = int(fraction["denominator"])
            if denominator == 0:
                return None
            value = int(token) + int(fraction["numerator"]) / denominator
            return (
                Visibility(statute_miles=round(value, 2), raw=f"{token} {tokens[index + 1]}"),
                2,
            )

    match = VISIBILITY_SM.match(token)
    if match is not None and (match["whole"] or match["numerator"]):
        miles = 0.0
        if match["whole"]:
            miles += int(match["whole"])
        if match["numerator"]:
            denominator = int(match["denominator"] or 0)
            if denominator == 0:
                return None
            miles += int(match["numerator"]) / denominator
        lead = match["lead"]
        return (
            Visibility(
                statute_miles=round(miles, 2),
                is_greater_than=lead == "P",
                is_less_than=lead == "M",
                raw=token,
            ),
            1,
        )

    match = VISIBILITY_METRES.match(token)
    if match is not None:
        metres = int(match["metres"])
        return (
            Visibility(
                statute_miles=round(metres / METRES_PER_STATUTE_MILE, 2),
                is_greater_than=metres >= 9999,
                raw=token,
            ),
            1,
        )

    return None


def build_cloud(match: re.Match[str]) -> CloudLayer:
    base = match["base"]
    cloud_type = match["type"]
    return CloudLayer(
        cover=match["cover"],
        base_ft=int(base) * 100 if base.isdigit() else None,
        cloud_type=cloud_type if cloud_type in {"CB", "TCU"} else None,
    )


def build_vertical_visibility(match: re.Match[str]) -> CloudLayer:
    base = match["base"]
    return CloudLayer(cover="VV", base_ft=int(base) * 100 if base.isdigit() else None)


def is_weather(token: str) -> bool:
    body = token
    if body.startswith(("-", "+")):
        body = body[1:]
    elif body.startswith("VC"):
        body = body[2:]

    if body == "NSW":
        return True
    if not body or len(body) % 2 != 0:
        return False
    return all(body[i : i + 2] in WEATHER_CODES for i in range(0, len(body), 2))
