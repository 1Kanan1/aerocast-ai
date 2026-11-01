"""Deterministic METAR parser.

Grammar in, frozen dataclasses out. No network, no database, and no implicit clock: the
caller supplies the reference time used to resolve the day-of-month, because a METAR only
carries `DDHHMMZ` and determinism matters more than convenience here.

The parser is tolerant by design. Anything it does not recognise lands in `unparsed`
rather than raising, so a single odd token cannot take out a whole observation. Only a
report with no station or no valid timestamp is a hard failure, because those cannot be
placed on a timeline at all.
"""

from __future__ import annotations

import calendar
import re
from datetime import UTC, datetime, timedelta

from app.domain.metar.models import CloudLayer, Observation, Visibility, Wind

METRES_PER_STATUTE_MILE = 1609.344
KNOTS_PER_METRE_PER_SECOND = 1.943844
KNOTS_PER_KM_PER_HOUR = 0.539957

#: Bumped whenever parsed output changes, and stored with every observation so a
#: historical row can be traced to the code that produced it.
PARSER_VERSION = "metar-1.0.0"


class MetarParseError(ValueError):
    """The report cannot be placed on a timeline."""


_REPORT_TIME = re.compile(r"^(?P<day>\d{2})(?P<hour>\d{2})(?P<minute>\d{2})Z$")
_STATION = re.compile(r"^[A-Z][A-Z0-9]{2,3}$")

_WIND = re.compile(
    r"^(?P<direction>\d{3}|VRB)(?P<speed>\d{2,3})(?:G(?P<gust>\d{2,3}))?(?P<unit>KT|MPS|KMH)$"
)
_WIND_VARIATION = re.compile(r"^(?P<start>\d{3})V(?P<end>\d{3})$")
_CLOUD = re.compile(r"^(?P<cover>FEW|SCT|BKN|OVC)(?P<base>\d{3}|///)(?P<type>CB|TCU|///)?$")
_VERTICAL_VISIBILITY = re.compile(r"^VV(?P<base>\d{3}|///)$")
_VISIBILITY_SM = re.compile(
    r"^(?P<lead>[MP])?(?P<whole>\d{1,2})?"
    r"(?:(?P<numerator>\d{1,2})/(?P<denominator>\d{1,2}))?SM$"
)
_VISIBILITY_FRACTION = re.compile(r"^(?P<numerator>\d{1,2})/(?P<denominator>\d{1,2})SM$")
_VISIBILITY_METRES = re.compile(r"^(?P<metres>\d{4})(?:NDV)?$")
_WHOLE_NUMBER = re.compile(r"^\d{1,2}$")
_TEMPERATURE = re.compile(r"^(?P<temperature>M?\d{2})/(?P<dewpoint>M?\d{2}|//)?$")
_ALTIMETER_INHG = re.compile(r"^A(?P<value>\d{4})$")
_ALTIMETER_HPA = re.compile(r"^Q(?P<value>\d{4})$")
#: Precise temperatures live in the remarks as tenths: T00221017 is +2.2 / -1.7.
#: The dewpoint half is optional in the wild: T0178 and T0151//// both occur.
_TEMPERATURE_GROUP = re.compile(
    r"\bT(?P<temp_sign>[01])(?P<temperature>\d{3})"
    r"(?:(?P<dew_sign>[01])(?P<dewpoint>\d{3}))?\b"
)

SKY_CLEAR = frozenset({"SKC", "CLR", "NSC", "NCD"})
MODIFIERS = frozenset({"AUTO", "COR", "CCA", "CCB", "RTD"})

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


def parse_metar(raw: str, reference: datetime | None = None) -> Observation:
    """Parse one raw METAR or SPECI report.

    `reference` anchors the day-of-month. Pass the fetch time, or the upstream report
    time when it is available. Without it, the current UTC time is used.
    """
    text = " ".join(raw.split()).rstrip("=").strip()
    if not text:
        raise MetarParseError("empty report")

    tokens = text.split(" ")
    report_type = "METAR"
    if tokens[0] in {"METAR", "SPECI"}:
        report_type = tokens.pop(0)

    if not tokens:
        raise MetarParseError("missing station identifier")
    station = tokens.pop(0)
    if not _STATION.match(station):
        raise MetarParseError(f"invalid station identifier: {station!r}")

    if not tokens:
        raise MetarParseError("missing observation time")
    time_match = _REPORT_TIME.match(tokens.pop(0))
    if time_match is None:
        raise MetarParseError("missing observation time")

    observed_at = _resolve_time(
        int(time_match["day"]),
        int(time_match["hour"]),
        int(time_match["minute"]),
        reference,
    )

    is_automated = False
    is_corrected = False
    while tokens and tokens[0] in MODIFIERS:
        modifier = tokens.pop(0)
        is_automated = is_automated or modifier == "AUTO"
        is_corrected = is_corrected or modifier == "COR"

    body, remarks = _split_remarks(tokens)

    wind: Wind | None = None
    visibility: Visibility | None = None
    weather: list[str] = []
    clouds: list[CloudLayer] = []
    temperature_c: float | None = None
    dewpoint_c: float | None = None
    altimeter_in_hg: float | None = None
    is_cavok = False
    unparsed: list[str] = []

    index = 0
    while index < len(body):
        token = body[index]

        if token == "CAVOK":
            is_cavok = True
            visibility = Visibility(
                statute_miles=round(10_000 / METRES_PER_STATUTE_MILE, 2),
                is_greater_than=True,
                raw=token,
            )
            index += 1
            continue

        if wind is None:
            match = _WIND.match(token)
            if match is not None:
                wind = _build_wind(match, token)
                index += 1
                continue

        if wind is not None and _WIND_VARIATION.match(token):
            match = _WIND_VARIATION.match(token)
            assert match is not None  # narrowed by the check above
            wind = _with_variation(wind, int(match["start"]), int(match["end"]))
            index += 1
            continue

        if visibility is None:
            parsed_visibility = _parse_visibility(body, index)
            if parsed_visibility is not None:
                visibility, consumed = parsed_visibility
                index += consumed
                continue

        match = _CLOUD.match(token)
        if match is not None:
            clouds.append(_build_cloud(match))
            index += 1
            continue

        match = _VERTICAL_VISIBILITY.match(token)
        if match is not None:
            clouds.append(_build_vertical_visibility(match))
            index += 1
            continue

        if token in SKY_CLEAR:
            index += 1
            continue

        if temperature_c is None:
            match = _TEMPERATURE.match(token)
            if match is not None:
                temperature_c = _signed(match["temperature"])
                if match["dewpoint"] and match["dewpoint"] != "//":
                    dewpoint_c = _signed(match["dewpoint"])
                index += 1
                continue

        if altimeter_in_hg is None:
            match = _ALTIMETER_INHG.match(token)
            if match is not None:
                altimeter_in_hg = int(match["value"]) / 100
                index += 1
                continue
            match = _ALTIMETER_HPA.match(token)
            if match is not None:
                altimeter_in_hg = round(int(match["value"]) / 33.8639, 2)
                index += 1
                continue

        if _is_weather(token):
            weather.append(token)
            index += 1
            continue

        if set(token) == {"/"}:
            # Placeholder for a group the station did not report. Nothing to learn.
            index += 1
            continue

        unparsed.append(token)
        index += 1

    # The remarks carry tenths of a degree, which is what AWC publishes. Prefer them:
    # the body group is rounded to whole degrees and loses information the sensor had.
    precise_temperature, precise_dewpoint = _parse_precise_temperatures(remarks)
    if precise_temperature is not None:
        temperature_c = precise_temperature
    if precise_dewpoint is not None:
        dewpoint_c = precise_dewpoint

    return Observation(
        station=station,
        report_type=report_type,
        observed_at=observed_at,
        raw=text,
        is_automated=is_automated,
        is_corrected=is_corrected,
        wind=wind,
        visibility=visibility,
        weather=tuple(weather),
        clouds=tuple(clouds),
        temperature_c=temperature_c,
        dewpoint_c=dewpoint_c,
        altimeter_in_hg=altimeter_in_hg,
        is_cavok=is_cavok,
        remarks=remarks,
        unparsed=tuple(unparsed),
    )


def _split_remarks(tokens: list[str]) -> tuple[list[str], str | None]:
    if "RMK" not in tokens:
        return tokens, None
    index = tokens.index("RMK")
    return tokens[:index], " ".join(tokens[index + 1 :]) or None


def _resolve_time(
    day: int,
    hour: int,
    minute: int,
    reference: datetime | None,
) -> datetime:
    """Pick the month the report belongs to.

    A METAR carries no month, so the day-of-month is resolved against the reference time
    and rolled back a month when the timestamp would otherwise be in the future.
    """
    ref = reference or datetime.now(UTC)
    ref = ref.astimezone(UTC)

    year, month = ref.year, ref.month
    if day > calendar.monthrange(year, month)[1]:
        year, month = _previous_month(year, month)

    candidate = _build_datetime(year, month, day, hour, minute)
    if candidate - ref > timedelta(hours=1):
        previous_year, previous_month = _previous_month(year, month)
        candidate = _build_datetime(previous_year, previous_month, day, hour, minute)
    return candidate


def _previous_month(year: int, month: int) -> tuple[int, int]:
    return (year - 1, 12) if month == 1 else (year, month - 1)


def _build_datetime(year: int, month: int, day: int, hour: int, minute: int) -> datetime:
    day = min(day, calendar.monthrange(year, month)[1])
    try:
        return datetime(year, month, day, hour, minute, tzinfo=UTC)
    except ValueError as exc:
        raise MetarParseError(
            f"invalid observation time {day:02d}{hour:02d}{minute:02d}Z"
        ) from exc


def _build_wind(match: re.Match[str], token: str) -> Wind:
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


def _with_variation(wind: Wind, start: int, end: int) -> Wind:
    return Wind(
        direction_deg=wind.direction_deg,
        speed_kt=wind.speed_kt,
        gust_kt=wind.gust_kt,
        is_variable=wind.is_variable,
        variation_from_deg=start,
        variation_to_deg=end,
        raw=f"{wind.raw} {start:03d}V{end:03d}",
    )


def _parse_visibility(tokens: list[str], index: int) -> tuple[Visibility, int] | None:
    token = tokens[index]

    # "1 1/2SM" arrives as two tokens.
    if _WHOLE_NUMBER.match(token) and index + 1 < len(tokens):
        fraction = _VISIBILITY_FRACTION.match(tokens[index + 1])
        if fraction is not None:
            denominator = int(fraction["denominator"])
            if denominator == 0:
                return None
            value = int(token) + int(fraction["numerator"]) / denominator
            return (
                Visibility(statute_miles=round(value, 2), raw=f"{token} {tokens[index + 1]}"),
                2,
            )

    match = _VISIBILITY_SM.match(token)
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

    match = _VISIBILITY_METRES.match(token)
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


def _build_cloud(match: re.Match[str]) -> CloudLayer:
    base = match["base"]
    cloud_type = match["type"]
    return CloudLayer(
        cover=match["cover"],
        base_ft=int(base) * 100 if base.isdigit() else None,
        cloud_type=cloud_type if cloud_type in {"CB", "TCU"} else None,
    )


def _build_vertical_visibility(match: re.Match[str]) -> CloudLayer:
    base = match["base"]
    return CloudLayer(cover="VV", base_ft=int(base) * 100 if base.isdigit() else None)


def _signed(value: str) -> float:
    return -float(value[1:]) if value.startswith("M") else float(value)


def _parse_precise_temperatures(remarks: str | None) -> tuple[float | None, float | None]:
    if not remarks:
        return None, None
    match = _TEMPERATURE_GROUP.search(remarks)
    if match is None:
        return None, None

    def tenths(sign: str, digits: str) -> float:
        value = int(digits) / 10
        return -value if sign == "1" else value

    return (
        tenths(match["temp_sign"], match["temperature"]),
        tenths(match["dew_sign"], match["dewpoint"]) if match["dew_sign"] else None,
    )


def _is_weather(token: str) -> bool:
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
