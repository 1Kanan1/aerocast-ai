"""Deterministic TAF parser.

`FM` truncates the prevailing period, `BECMG` starts a new one, and
`TEMPO`, `PROB30/40` and `INTER` are windows inside it that never
truncate. Report order is preserved.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime

from app.domain.taf.models import (
    BECMG,
    FM,
    INITIAL,
    INTER,
    PROB,
    TEMPO,
    TRANSIENT_CHANGES,
    Taf,
    TafPeriod,
)
from app.domain.taf.windows import (
    MAX_VALIDITY,
    TafParseError,
    resolve_day,
    resolve_spec,
    resolve_validity_end,
    resolve_window_spec,
)
from app.domain.weather.tokens import scan_conditions

PARSER_VERSION = "taf-1.0.0"

_STATION = re.compile(r"^[A-Z][A-Z0-9]{2,3}$")
_ISSUE_TIME = re.compile(r"^(?P<day>\d{2})(?P<hour>\d{2})(?P<minute>\d{2})Z$")
_VALIDITY = re.compile(r"^(?P<from>\d{4})/(?P<to>\d{4})$")
_FM = re.compile(r"^FM(?P<spec>\d{6}|\d{4})$")
_WINDOW_SPEC = re.compile(
    r"^(?P<start>\d{6}|\d{4})(?:/(?P<end>\d{6}|\d{4}))?$"
)
_PROBABILITY = re.compile(r"^PROB(?P<value>\d{2})$")

MODIFIERS = frozenset({"AMD", "COR"})


@dataclass
class _Group:
    change: str
    tokens: list[str] = field(default_factory=list)
    probability: int | None = None
    start_spec: str | None = None
    end_spec: str | None = None


@dataclass(frozen=True, slots=True)
class _Resolved:
    group: _Group
    starts_at: datetime
    ends_at: datetime | None


def parse_taf(raw: str, reference: datetime | None = None) -> Taf:
    """Parse one TAF. `reference` anchors the day-of-month; defaults to now."""
    text = " ".join(raw.split()).rstrip("=").strip()
    if not text:
        raise TafParseError("empty report")

    tokens = text.split(" ")
    if tokens and tokens[0] == "TAF":
        tokens.pop(0)

    is_amended = False
    is_corrected = False
    while tokens and tokens[0] in MODIFIERS:
        modifier = tokens.pop(0)
        is_amended = is_amended or modifier == "AMD"
        is_corrected = is_corrected or modifier == "COR"

    if not tokens:
        raise TafParseError("missing station identifier")
    station = tokens.pop(0)
    if not _STATION.match(station):
        raise TafParseError(f"invalid station identifier: {station!r}")

    anchor = reference or datetime.now(UTC)

    issued_at: datetime | None = None
    if tokens and _ISSUE_TIME.match(tokens[0]):
        issue = _ISSUE_TIME.match(tokens.pop(0))
        assert issue is not None
        issued_at = resolve_day(
            int(issue["day"]), int(issue["hour"]), int(issue["minute"]), anchor
        )

    if not tokens:
        raise TafParseError("missing validity window")
    validity = _VALIDITY.match(tokens.pop(0))
    if validity is None:
        raise TafParseError("missing validity window")

    valid_from = resolve_day(
        int(validity["from"][0:2]),
        int(validity["from"][2:4]),
        0,
        issued_at or anchor,
    )
    valid_to = resolve_validity_end(
        int(validity["to"][0:2]),
        int(validity["to"][2:4]),
        0,
        valid_from,
    )
    if valid_to <= valid_from or valid_to - valid_from > MAX_VALIDITY:
        raise TafParseError("validity window ends before it starts")

    groups = _split_groups(tokens)
    resolved = _resolve_groups(groups, valid_from)
    periods, unparsed = _build_periods(resolved, valid_from, valid_to)

    return Taf(
        station=station,
        issued_at=issued_at or valid_from,
        valid_from=valid_from,
        valid_to=valid_to,
        periods=tuple(periods),
        raw=text,
        is_amended=is_amended,
        is_corrected=is_corrected,
        unparsed=tuple(unparsed),
    )


def _split_groups(tokens: list[str]) -> list[_Group]:
    groups = [_Group(change=INITIAL)]
    index = 0

    while index < len(tokens):
        token = tokens[index]

        fm = _FM.match(token)
        if fm is not None:
            groups.append(_Group(change=FM, start_spec=fm["spec"]))
            index += 1
            continue

        probability = _PROBABILITY.match(token)
        if probability is not None:
            change = PROB
            index += 1
            if index < len(tokens) and tokens[index] == "TEMPO":
                change = f"{PROB} {TEMPO}"
                index += 1
            group = _Group(
                change=change, probability=int(probability["value"])
            )
            group.start_spec, group.end_spec, consumed = _take_window(
                tokens, index
            )
            groups.append(group)
            index += consumed
            continue

        if token in {TEMPO, BECMG, INTER}:
            group = _Group(change=token)
            group.start_spec, group.end_spec, consumed = _take_window(
                tokens, index + 1
            )
            groups.append(group)
            index += 1 + consumed
            continue

        groups[-1].tokens.append(token)
        index += 1

    return groups


def _take_window(
    tokens: list[str], index: int
) -> tuple[str | None, str | None, int]:
    if index >= len(tokens):
        return None, None, 0
    window = _WINDOW_SPEC.match(tokens[index])
    if window is None:
        return None, None, 0
    return window["start"], window["end"], 1


def _resolve_groups(
    groups: list[_Group], valid_from: datetime
) -> list[_Resolved]:
    resolved: list[_Resolved] = []
    previous_start = valid_from

    for group in groups:
        resolve_start = (
            resolve_spec if group.change == FM else resolve_window_spec
        )

        if group.start_spec is None:
            starts_at = valid_from
        else:
            starts_at = resolve_start(group.start_spec, previous_start)

        ends_at = None
        if group.end_spec is not None:
            ends_at = resolve_window_spec(group.end_spec, starts_at)

        if group.change not in TRANSIENT_CHANGES:
            previous_start = max(previous_start, starts_at)

        resolved.append(
            _Resolved(group=group, starts_at=starts_at, ends_at=ends_at)
        )

    return resolved


def _build_periods(
    resolved: list[_Resolved], valid_from: datetime, valid_to: datetime
) -> tuple[list[TafPeriod], list[str]]:
    prevailing = _prevailing_windows(resolved, valid_to)
    periods: list[TafPeriod] = []
    unparsed: list[str] = []

    for item in resolved:
        starts_at, ends_at = _window_for(item, prevailing)
        starts_at = max(starts_at, valid_from)
        ends_at = min(ends_at, valid_to)
        if ends_at <= starts_at:
            ends_at = min(starts_at, valid_to)

        conditions = scan_conditions(item.group.tokens)
        unparsed.extend(conditions.unparsed)

        periods.append(
            TafPeriod(
                change=item.group.change,
                starts_at=starts_at,
                ends_at=ends_at,
                probability=item.group.probability,
                is_temporary=item.group.change in TRANSIENT_CHANGES,
                wind=conditions.wind,
                visibility=conditions.visibility,
                weather=tuple(conditions.weather),
                clouds=tuple(conditions.clouds),
                raw=" ".join(item.group.tokens),
            )
        )

    return periods, unparsed


def _prevailing_windows(
    resolved: list[_Resolved], valid_to: datetime
) -> list[tuple[datetime, datetime]]:
    """Each prevailing group runs until the next one starts."""
    windows: list[tuple[datetime, datetime]] = []

    for position, item in enumerate(resolved):
        if item.group.change in TRANSIENT_CHANGES:
            continue
        next_start = next(
            (
                later.starts_at
                for later in resolved[position + 1 :]
                if later.group.change not in TRANSIENT_CHANGES
            ),
            valid_to,
        )
        windows.append((item.starts_at, max(item.starts_at, next_start)))

    return windows


def _window_for(
    item: _Resolved, prevailing: list[tuple[datetime, datetime]]
) -> tuple[datetime, datetime]:
    if item.group.change in TRANSIENT_CHANGES:
        return item.starts_at, item.ends_at or _enclosing_end(
            prevailing, item.starts_at
        )
    return _window_starting_at(prevailing, item.starts_at)


def _window_starting_at(
    windows: list[tuple[datetime, datetime]], starts_at: datetime
) -> tuple[datetime, datetime]:
    for start, end in windows:
        if start == starts_at:
            return (start, end)
    fallback = windows[-1] if windows else (starts_at, starts_at)
    return (max(starts_at, fallback[0]), fallback[1])


def _enclosing_end(
    windows: list[tuple[datetime, datetime]], starts_at: datetime
) -> datetime:
    for start, end in windows:
        if start <= starts_at < end:
            return end
    return windows[-1][1] if windows else starts_at
