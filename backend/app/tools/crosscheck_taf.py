"""Compare the TAF parser against AWC's own decoder.

    uv run python -m app.tools.crosscheck_taf

Forecasts in the cache are not in report order, so periods are matched by
their time window rather than by position.
"""

from __future__ import annotations

import argparse
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from app.domain.taf import PARSER_VERSION, Taf, TafParseError, parse_taf
from app.domain.taf.models import TafPeriod
from app.domain.weather.models import CloudLayer
from app.tools.cache import (
    as_integer,
    as_number,
    as_timestamp,
    decompress,
    download,
    is_us,
)

CACHE_URL = "https://aviationweather.gov/data/cache/tafs.cache.xml.gz"
BACKEND_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REPORT = BACKEND_ROOT / "tests" / "golden" / "crosscheck_taf.md"

#: Minimum agreement rate per field when --enforce is set.
THRESHOLDS = {
    "period_count": 0.97,
    "period_window": 0.97,
    "wind_direction": 0.995,
    "wind_speed": 0.995,
    "visibility": 0.99,
    "clouds": 0.98,
}

MAX_EXAMPLES = 4

#: AWC emits clear-sky as a layer with no base, and vertical visibility as OVX.
CLEAR_SKY = frozenset({"SKC", "CLR", "NSC", "NCD"})


@dataclass(frozen=True)
class UpstreamForecast:
    starts_at: datetime | None
    ends_at: datetime | None
    change: str
    wind_direction: int | None
    wind_speed: int | None
    visibility: float | None
    clouds: tuple[tuple[str, int | None], ...]


@dataclass(frozen=True)
class UpstreamTaf:
    raw: str
    station: str
    issued_at: datetime | None
    forecasts: tuple[UpstreamForecast, ...]


@dataclass
class Tally:
    compared: int = 0
    agree: int = 0
    uncompared: int = 0
    examples: list[str] = field(default_factory=list)

    @property
    def disagree(self) -> int:
        return self.compared - self.agree

    @property
    def rate(self) -> float | None:
        return None if self.compared == 0 else self.agree / self.compared

    def record(self, ok: bool | None, example: str) -> None:
        if ok is None:
            self.uncompared += 1
            return
        self.compared += 1
        if ok:
            self.agree += 1
        elif len(self.examples) < MAX_EXAMPLES:
            self.examples.append(example)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--xml", type=Path, help="read a local cache file instead of fetching"
    )
    parser.add_argument(
        "--all", action="store_true", help="include non-US stations"
    )
    parser.add_argument(
        "--limit", type=int, help="only analyse the first N stations"
    )
    parser.add_argument(
        "--report", type=Path, default=DEFAULT_REPORT, help="markdown output"
    )
    parser.add_argument(
        "--enforce", action="store_true", help="exit 1 when a threshold fails"
    )
    args = parser.parse_args(argv)

    payload = args.xml.read_bytes() if args.xml else download(CACHE_URL)
    rows = list(_read_tafs(decompress(payload)))

    parsed = 0
    skipped = 0
    considered = 0
    tallies: dict[str, Tally] = defaultdict(Tally)

    for row in rows:
        if not args.all and not is_us(row.station):
            continue
        considered += 1
        if args.limit is not None and considered > args.limit:
            break

        try:
            taf = parse_taf(row.raw, reference=row.issued_at)
        except TafParseError:
            skipped += 1
            continue
        parsed += 1

        for name, ok, detail in _compare(row, taf):
            tallies[name].record(ok, detail)

    report = _render_markdown(
        considered=considered, parsed=parsed, skipped=skipped, tallies=tallies
    )
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(report, encoding="utf-8")

    print(report)
    print(f"\nwrote {args.report}")

    if args.enforce:
        failures = [
            f"{name} {tally.rate:.2%} < {THRESHOLDS[name]:.2%}"
            for name, tally in tallies.items()
            if tally.rate is not None and tally.rate < THRESHOLDS[name]
        ]
        if failures:
            print("\nthreshold failures:", file=sys.stderr)
            for failure in failures:
                print(f"  {failure}", file=sys.stderr)
            return 1

    return 0


def _read_tafs(text: str) -> Iterable[UpstreamTaf]:
    root = ET.fromstring(text)
    for element in root.iter("TAF"):
        yield UpstreamTaf(
            raw=element.findtext("raw_text", default=""),
            station=element.findtext("station_id", default=""),
            issued_at=as_timestamp(element.findtext("issue_time")),
            forecasts=tuple(
                _forecast(child) for child in element.findall("forecast")
            ),
        )


def _forecast(element: ET.Element) -> UpstreamForecast:
    return UpstreamForecast(
        starts_at=as_timestamp(element.findtext("fcst_time_from")),
        ends_at=as_timestamp(element.findtext("fcst_time_to")),
        change=element.findtext("change_indicator") or "INITIAL",
        wind_direction=as_integer(element.findtext("wind_dir_degrees")),
        wind_speed=as_integer(element.findtext("wind_speed_kt")),
        visibility=as_number(element.findtext("visibility_statute_mi")),
        clouds=tuple(
            (
                condition.get("sky_cover", ""),
                as_integer(condition.get("cloud_base_ft_agl")),
            )
            for condition in element.findall("sky_condition")
        ),
    )


def _compare(
    row: UpstreamTaf, taf: Taf
) -> Iterable[tuple[str, bool | None, str]]:
    ours_by_window = {
        (period.starts_at, period.ends_at): period for period in taf.periods
    }

    yield (
        "period_count",
        len(row.forecasts) == len(taf.periods),
        f"{row.station} {row.raw} | counts ours={len(taf.periods)} "
        f"awc={len(row.forecasts)}",
    )

    for forecast in row.forecasts:
        window = (forecast.starts_at, forecast.ends_at)
        period = ours_by_window.get(window)
        detail = (
            f"{row.station} {row.raw} | window {forecast.change} "
            f"{forecast.starts_at} to {forecast.ends_at}"
        )
        yield "period_window", period is not None, detail
        if period is None:
            continue
        # AWC folds inherited conditions into TEMPO and PROB entries, while we
        # keep each group exactly as written. Comparing them would measure that
        # difference rather than the parse, so only prevailing periods count.
        if period.is_temporary:
            continue

        yield from _compare_period(row, period, forecast)


def _compare_period(
    row: UpstreamTaf, period: TafPeriod, forecast: UpstreamForecast
) -> Iterable[tuple[str, bool | None, str]]:
    our_direction = period.wind.direction_deg if period.wind else None
    our_speed = period.wind.speed_kt if period.wind else None

    direction_ok = _close(our_direction, forecast.wind_direction, 0)
    if our_direction is None and forecast.wind_direction == 0:
        direction_ok = True

    yield (
        "wind_direction",
        direction_ok,
        _detail(
            row,
            period,
            f"wind_dir ours={our_direction} awc={forecast.wind_direction}",
        ),
    )
    yield (
        "wind_speed",
        _close(our_speed, forecast.wind_speed, 0),
        _detail(
            row,
            period,
            f"wind_speed ours={our_speed} awc={forecast.wind_speed}",
        ),
    )
    yield (
        "visibility",
        _visibility_match(period, forecast),
        _detail(
            row,
            period,
            f"vis ours={period.visibility_sm} awc={forecast.visibility}",
        ),
    )
    yield (
        "clouds",
        _clouds_match(period.clouds, forecast.clouds),
        _detail(
            row,
            period,
            f"clouds ours={_format_ours(period.clouds)} "
            f"awc={_format_theirs(forecast.clouds)}",
        ),
    )


def _visibility_match(
    period: TafPeriod, forecast: UpstreamForecast
) -> bool | None:
    visibility = period.visibility
    if visibility is None or visibility.statute_miles is None:
        return None
    if forecast.visibility is None:
        return None
    # AWC caps "10 km or more" and "P6SM" at 6.0.
    if visibility.is_greater_than:
        return forecast.visibility >= 6
    return abs(visibility.statute_miles - forecast.visibility) <= 0.05


def _clouds_match(
    ours: Sequence[CloudLayer], theirs: Sequence[tuple[str, int | None]]
) -> bool | None:
    mine = _normalize_layers([(layer.cover, layer.base_ft) for layer in ours])
    upstream = _normalize_layers(theirs)
    if not mine and not upstream:
        return None
    if mine == upstream:
        return True
    # The cache drops layers beyond its own limit, so a shorter upstream list
    # that matches our prefix is truncation rather than a disagreement.
    return len(upstream) < len(mine) and mine[: len(upstream)] == upstream


def _normalize_layers(
    layers: Sequence[tuple[str, int | None]],
) -> list[tuple[str, int | None]]:
    normalized: list[tuple[str, int | None]] = []
    for cover, base in layers:
        if cover in CLEAR_SKY:
            continue
        if cover == "OVX" or cover == "VV":
            normalized.append(("VV", None))
            continue
        if base is None:
            continue
        normalized.append((cover, base))
    return normalized


def _close(
    left: float | int | None, right: float | int | None, tolerance: float
) -> bool | None:
    if left is None or right is None:
        return None
    return abs(float(left) - float(right)) <= tolerance


def _detail(row: UpstreamTaf, period: TafPeriod, message: str) -> str:
    return (
        f"{row.station} {period.change} {period.starts_at} | {message} "
        f"| {row.raw}"
    )


def _format_ours(layers: Sequence[CloudLayer]) -> str:
    return " ".join(f"{layer.cover}{layer.base_ft}" for layer in layers) or "-"


def _format_theirs(layers: Sequence[tuple[str, int | None]]) -> str:
    return " ".join(f"{cover}{base}" for cover, base in layers) or "-"


def _render_markdown(
    *,
    considered: int,
    parsed: int,
    skipped: int,
    tallies: dict[str, Tally],
) -> str:
    generated = datetime.now().astimezone().isoformat(timespec="seconds")
    lines = [
        "# TAF cross-check",
        "",
        f"- parser: `{PARSER_VERSION}`",
        f"- generated: {generated}",
        f"- source: {CACHE_URL}",
        f"- reports: {parsed:,} parsed, {skipped:,} skipped, "
        f"{considered:,} considered",
        "",
        "| Field | Compared | Agree | Disagree | Missing | Agreement |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]

    for name in THRESHOLDS:
        tally = tallies.get(name)
        if tally is None or tally.rate is None:
            lines.append(f"| {name} | 0 | 0 | 0 | 0 | n/a |")
            continue
        lines.append(
            f"| {name} | {tally.compared:,} | {tally.agree:,} "
            f"| {tally.disagree:,} | {tally.uncompared:,} "
            f"| {tally.rate:.2%} |"
        )

    lines.append("")
    lines.append(
        "Periods are matched on their time window, because the cache does"
    )
    lines.append("not preserve report order.")
    lines.append("")

    for name in THRESHOLDS:
        tally = tallies.get(name)
        if tally is None or not tally.examples:
            continue
        lines.append(f"### {name}: {tally.disagree:,} disagreements")
        lines.append("")
        for example in tally.examples:
            lines.append(f"- {example}")
        lines.append("")

    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
