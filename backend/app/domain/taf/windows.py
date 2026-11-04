"""Day-of-month resolution for TAF change groups."""

from __future__ import annotations

import calendar
from datetime import UTC, datetime, timedelta

#: A group this far behind the validity start is last month.
BACKWARD_TOLERANCE = timedelta(hours=18)

#: Longest TAF validity in practice; anything longer is a malformed window.
MAX_VALIDITY = timedelta(hours=36)


class TafParseError(ValueError):
    """The TAF cannot be placed on a timeline."""


def resolve_day(
    day: int,
    hour: int,
    minute: int,
    anchor: datetime,
) -> datetime:
    """Resolve a bare day-of-month against an anchor."""
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
    """Resolve an `FM` time: `DDHHMM` when six digits, `HHMM` when four."""
    spec = spec.strip()
    if len(spec) == 6 and spec.isdigit():
        return resolve_day(
            int(spec[0:2]), int(spec[2:4]), int(spec[4:6]), anchor
        )

    if len(spec) == 4 and spec.isdigit():
        base = anchor.astimezone(UTC)
        candidate = _build(
            base.year, base.month, base.day, int(spec[0:2]), int(spec[2:4])
        )
        if candidate <= base:
            candidate += timedelta(days=1)
        return candidate

    raise TafParseError(f"invalid time spec: {spec!r}")


def resolve_window_spec(spec: str, anchor: datetime) -> datetime:
    """Resolve a window spec: `DDHHMM` if six digits, `DDHH` if four."""
    spec = spec.strip()
    if len(spec) == 6 and spec.isdigit():
        return resolve_day(
            int(spec[0:2]), int(spec[2:4]), int(spec[4:6]), anchor
        )

    if len(spec) == 4 and spec.isdigit():
        return resolve_day(int(spec[0:2]), int(spec[2:4]), 0, anchor)

    raise TafParseError(f"invalid time spec: {spec!r}")


def resolve_validity_end(
    day: int,
    hour: int,
    minute: int,
    start: datetime,
) -> datetime:
    """Resolve the end of a validity window, taking the next month."""
    start = start.astimezone(UTC)
    candidate = _build(start.year, start.month, day, hour, minute)
    if candidate <= start:
        year, month = _next_month(start.year, start.month)
        candidate = _build(year, month, day, hour, minute)
    return candidate


def _next_month(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


def _build(
    year: int, month: int, day: int, hour: int, minute: int
) -> datetime:
    day = min(day, calendar.monthrange(year, month)[1])
    # Military products write 2400 for midnight at the end of the day.
    carry = timedelta(0)
    if hour == 24:
        hour, carry = 0, timedelta(days=1)
    try:
        return datetime(year, month, day, hour, minute, tzinfo=UTC) + carry
    except ValueError as exc:
        raise TafParseError(
            f"invalid time {day:02d}{hour:02d}{minute:02d}"
        ) from exc
