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

from app.domain.metar.models import Observation
from app.domain.weather.models import HPA_PER_INHG
from app.domain.weather.tokens import scan_conditions

#: Bumped whenever parsed output changes, and stored with every observation so a
#: historical row can be traced to the code that produced it.
PARSER_VERSION = "metar-1.1.0"

_REPORT_TIME = re.compile(r"^(?P<day>\d{2})(?P<hour>\d{2})(?P<minute>\d{2})Z$")
_STATION = re.compile(r"^[A-Z][A-Z0-9]{2,3}$")
_TEMPERATURE = re.compile(r"^(?P<temperature>M?\d{2})/(?P<dewpoint>M?\d{2}|//)?$")
_ALTIMETER_INHG = re.compile(r"^A(?P<value>\d{4})$")
_ALTIMETER_HPA = re.compile(r"^Q(?P<value>\d{4})$")
#: Precise temperatures live in the remarks as tenths: T00221017 is +2.2 / -1.7.
#: The dewpoint half is optional in the wild: T0178 and T0151//// both occur.
_TEMPERATURE_GROUP = re.compile(
    r"\bT(?P<temp_sign>[01])(?P<temperature>\d{3})"
    r"(?:(?P<dew_sign>[01])(?P<dewpoint>\d{3}))?\b"
)

MODIFIERS = frozenset({"AUTO", "COR", "CCA", "CCB", "RTD"})


class MetarParseError(ValueError):
    """The report cannot be placed on a timeline."""


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
    conditions = scan_conditions(body)

    temperature_c, dewpoint_c, altimeter_in_hg, unparsed = _scan_observation_groups(
        conditions.unparsed
    )

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
        wind=conditions.wind,
        visibility=conditions.visibility,
        weather=tuple(conditions.weather),
        clouds=tuple(conditions.clouds),
        temperature_c=temperature_c,
        dewpoint_c=dewpoint_c,
        altimeter_in_hg=altimeter_in_hg,
        is_cavok=conditions.is_cavok,
        remarks=remarks,
        unparsed=tuple(unparsed),
    )


def _split_remarks(tokens: list[str]) -> tuple[list[str], str | None]:
    if "RMK" not in tokens:
        return tokens, None
    index = tokens.index("RMK")
    return tokens[:index], " ".join(tokens[index + 1 :]) or None


def _scan_observation_groups(
    tokens: list[str],
) -> tuple[float | None, float | None, float | None, list[str]]:
    """Pull the groups that only a METAR carries out of the leftover tokens."""
    temperature_c: float | None = None
    dewpoint_c: float | None = None
    altimeter_in_hg: float | None = None
    unparsed: list[str] = []

    for token in tokens:
        if temperature_c is None:
            match = _TEMPERATURE.match(token)
            if match is not None:
                temperature_c = _signed(match["temperature"])
                if match["dewpoint"] and match["dewpoint"] != "//":
                    dewpoint_c = _signed(match["dewpoint"])
                continue

        if altimeter_in_hg is None:
            match = _ALTIMETER_INHG.match(token)
            if match is not None:
                altimeter_in_hg = int(match["value"]) / 100
                continue
            match = _ALTIMETER_HPA.match(token)
            if match is not None:
                altimeter_in_hg = round(int(match["value"]) / HPA_PER_INHG, 2)
                continue

        unparsed.append(token)

    return temperature_c, dewpoint_c, altimeter_in_hg, unparsed


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
