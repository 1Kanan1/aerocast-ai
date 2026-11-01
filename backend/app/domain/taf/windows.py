"""Day-of-month resolution for TAF change groups.

A TAF reports `DDHHMM` with no month, and its validity window can straddle a month
boundary (`3022/0106`). Everything is in Zulu, so there is no DST case to worry about,
which is the one mercy in this file.
"""

from __future__ import annotations

import calendar
from datetime import UTC, datetime, timedelta

#: A change group cannot legitimately sit more than this far behind the validity start
#: without belonging to the previous month.
BACKWARD_TOLERANCE = timedelta(hours=18)

#: Longest TAF validity in practice is 30 hours. Anything beyond this is a malformed
#: window rather than a forecast.
MAX_VALIDITY = timedelta(hours=36)


class TafParseError(ValueError):
    """The TAF cannot be placed on a timeline."""


def resolve_day(
    day: int,
    hour: int,
    minute: int,
    anchor: datetime,
) -> datetime:
    """Resolve a bare day-of-month against an anchor time.

    Rolls forward a month when the result lands well before the anchor, which is what
    happens to the `0106` half of a `3022/0106` validity window.
    """
    anchor = anchor.astimezone(UTC)
    year, month = anchor.year, anchor.month

    if day > calendar.monthrange(year, month)[1]:
        year, month = _next_month(year, month)

    candidate = _build(year, month, day, hour, minute)
    if candidate < anchor - BACKWARD_TOLERANCE:
        year, month = _next_month(year, month)
        candidate = _build(year, month, day, hour, minute)
    return candidate


def resolve_spec(spec: str, anchor: datetime) -> datetime:
    """Resolve an `FM` time: `DDHHMM` when six digits, `HHMM` when four.

    A new prevailing period always starts after the previous one, so a four digit time
    that lands at or before the anchor belongs to the next day.
    """
    spec = spec.strip()
    if len(spec) == 6 and spec.isdigit():
        return resolve_day(int(spec[0:2]), int(spec[2:4]), int(spec[4:6]), anchor)

    if len(spec) == 4 and spec.isdigit():
        base = anchor.astimezone(UTC)
        candidate = _build(base.year, base.month, base.day, int(spec[0:2]), int(spec[2:4]))
        if candidate <= base:
            candidate += timedelta(days=1)
        return candidate

    raise TafParseError(f"invalid time spec: {spec!r}")


def resolve_window_spec(spec: str, anchor: datetime) -> datetime:
    """Resolve a change-group window: `DDHHMM` when six digits, `DDHH` when four.

    `BECMG`, `TEMPO` and `PROB` windows carry a day, unlike `FM`, which is why four digit
    specs here mean day-and-hour rather than hour-and-minute.
    """
    spec = spec.strip()
    if len(spec) == 6 and spec.isdigit():
        return resolve_day(int(spec[0:2]), int(spec[2:4]), int(spec[4:6]), anchor)

    if len(spec) == 4 and spec.isdigit():
        return resolve_day(int(spec[0:2]), int(spec[2:4]), 0, anchor)

    raise TafParseError(f"invalid time spec: {spec!r}")


def resolve_validity_end(
    day: int,
    hour: int,
    minute: int,
    start: datetime,
) -> datetime:
    """Resolve the end of a validity window.

    The end is a near-future time by construction, so unlike a change group it takes the
    next month whenever the same day would land on or before the start. A window longer
    than `MAX_VALIDITY` is rejected by the caller rather than silently shortened.
    """
    start = start.astimezone(UTC)
    candidate = _build(start.year, start.month, day, hour, minute)
    if candidate <= start:
        year, month = _next_month(start.year, start.month)
        candidate = _build(year, month, day, hour, minute)
    return candidate


def _next_month(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


def _build(year: int, month: int, day: int, hour: int, minute: int) -> datetime:
    day = min(day, calendar.monthrange(year, month)[1])
    try:
        return datetime(year, month, day, hour, minute, tzinfo=UTC)
    except ValueError as exc:
        raise TafParseError(f"invalid time {day:02d}{hour:02d}{minute:02d}") from exc
