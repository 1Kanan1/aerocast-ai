"""Compare the METAR parser against AWC's own decoder.

    uv run python -m app.tools.crosscheck_metar

Measures agreement, not correctness. US stations by default; `--enforce` exits 1 when a
per-field threshold regresses.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import sys
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import httpx

from app.domain.metar import PARSER_VERSION, MetarParseError, classify, parse_metar
from app.domain.metar.models import CloudLayer, Observation

CACHE_URL = "https://aviationweather.gov/data/cache/metars.cache.csv.gz"
USER_AGENT = "aerocast-crosscheck/0.1 (+https://github.com/)"

BACKEND_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REPORT = BACKEND_ROOT / "tests" / "golden" / "crosscheck.md"

#: Minimum agreement rate per field when --enforce is set.
THRESHOLDS = {
    "temperature": 0.995,
    "dewpoint": 0.995,
    "wind_direction": 0.995,
    "wind_speed": 0.995,
    "wind_gust": 0.995,
    "visibility": 0.99,
    "altimeter": 0.995,
    "clouds": 0.98,
    "flight_category": 0.99,
}

MAX_EXAMPLES = 4


@dataclass(frozen=True)
class UpstreamRow:
    raw: str
    station: str
    observed_at: datetime
    temperature: float | None
    dewpoint: float | None
    wind_direction: int | None
    wind_speed: int | None
    wind_gust: int | None
    visibility: float | None
    altimeter: float | None
    clouds: tuple[tuple[str, int | None], ...]
    category: str | None


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
    parser.add_argument("--csv", type=Path, help="read a local cache file instead of fetching")
    parser.add_argument("--all", action="store_true", help="include non-US stations")
    parser.add_argument("--limit", type=int, help="only analyse the first N rows")
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT, help="markdown output")
    parser.add_argument("--enforce", action="store_true", help="exit 1 when a threshold fails")
    args = parser.parse_args(argv)

    payload = args.csv.read_bytes() if args.csv else _download()
    text = _decompress(payload)

    rows = list(_read_rows(text))
    parsed = 0
    skipped = 0
    tallies: dict[str, Tally] = defaultdict(Tally)
    stations = 0

    for row in rows:
        if not args.all and not _is_us(row.station):
            continue
        stations += 1
        if args.limit is not None and stations > args.limit:
            break

        try:
            observation = parse_metar(row.raw, reference=row.observed_at)
        except MetarParseError:
            skipped += 1
            continue
        parsed += 1

        for name, ok, detail in _compare(row, observation):
            tallies[name].record(ok, f"`{row.station}` {detail}")

    report = _render_markdown(rows=stations, parsed=parsed, skipped=skipped, tallies=tallies)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(report, encoding="utf-8")

    print(report)
    print(f"\nwrote {args.report}")

    if skipped:
        print(f"warning: {skipped} reports could not be anchored to a time", file=sys.stderr)

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


def _download() -> bytes:
    response = httpx.get(
        CACHE_URL,
        headers={"User-Agent": USER_AGENT},
        timeout=60.0,
        follow_redirects=True,
    )
    response.raise_for_status()
    return response.content


def _decompress(payload: bytes) -> str:
    if payload[:2] == b"\x1f\x8b":
        payload = gzip.decompress(payload)
    return payload.decode("utf-8", errors="replace")


def _read_rows(text: str) -> Iterable[UpstreamRow]:
    reader = csv.reader(io.StringIO(text))
    header = next(reader)
    index = _column_index(header)

    cloud_slots = [
        (cover_position, index["cloud_base_ft_agl"][slot])
        for slot, cover_position in enumerate(index["sky_cover"])
    ]

    for values in reader:
        if not values or not values[index["raw_text"][0]].startswith(("METAR", "SPECI")):
            continue

        observed_at = _timestamp(values[index["observation_time"][0]])
        if observed_at is None:
            continue

        clouds: list[tuple[str, int | None]] = []
        for cover_position, base_position in cloud_slots:
            cover = _text(values, cover_position)
            if not cover:
                continue
            clouds.append((_normalize_cover(cover), _integer(_text(values, base_position))))

        yield UpstreamRow(
            raw=values[index["raw_text"][0]],
            station=_text(values, index["station_id"][0]) or "",
            observed_at=observed_at,
            temperature=_number(_text(values, index["temp_c"][0])),
            dewpoint=_number(_text(values, index["dewpoint_c"][0])),
            wind_direction=_integer(_text(values, index["wind_dir_degrees"][0])),
            wind_speed=_integer(_text(values, index["wind_speed_kt"][0])),
            wind_gust=_integer(_text(values, index["wind_gust_kt"][0])),
            visibility=_number(_text(values, index["visibility_statute_mi"][0])),
            altimeter=_number(_text(values, index["altim_in_hg"][0])),
            clouds=tuple(clouds),
            category=_text(values, index["flight_category"][0]) or None,
        )


def _column_index(header: list[str]) -> dict[str, list[int]]:
    index: dict[str, list[int]] = defaultdict(list)
    for position, name in enumerate(header):
        index[name].append(position)
    for required in ("raw_text", "station_id", "observation_time", "flight_category"):
        if required not in index:
            raise SystemExit(f"unexpected cache format: missing column {required!r}")
    return index


def _compare(
    row: UpstreamRow, observation: Observation
) -> Iterable[tuple[str, bool | None, str]]:
    yield "temperature", _close(observation.temperature_c, row.temperature, 0.05), _detail(
        row, f"temp ours={observation.temperature_c} awc={row.temperature}"
    )
    yield "dewpoint", _close(observation.dewpoint_c, row.dewpoint, 0.05), _detail(
        row, f"dewpoint ours={observation.dewpoint_c} awc={row.dewpoint}"
    )

    wind = observation.wind
    our_direction = wind.direction_deg if wind else None
    our_speed = wind.speed_kt if wind else None
    our_gust = wind.gust_kt if wind else None

    # VRB reports as 0 upstream; both mean "no single direction".
    if our_direction is None and row.wind_direction == 0:
        direction_ok: bool | None = True
    else:
        direction_ok = _close(our_direction, row.wind_direction, 0)

    yield "wind_direction", direction_ok, _detail(
        row, f"wind_dir ours={our_direction} awc={row.wind_direction}"
    )
    yield "wind_speed", _close(our_speed, row.wind_speed, 0), _detail(
        row, f"wind_speed ours={our_speed} awc={row.wind_speed}"
    )
    yield "wind_gust", _close(our_gust, row.wind_gust, 0), _detail(
        row, f"wind_gust ours={our_gust} awc={row.wind_gust}"
    )

    # A "P6SM" floor agrees with an upstream 6.0, which is where the cache caps it.
    if observation.visibility is not None and observation.visibility.is_greater_than:
        visibility_ok = True if row.visibility is not None and row.visibility >= 6 else None
    else:
        visibility_ok = _close(observation.visibility_sm, row.visibility, 0.05)
    yield "visibility", visibility_ok, _detail(
        row, f"vis ours={observation.visibility_sm} awc={row.visibility}"
    )

    yield "altimeter", _close(observation.altimeter_in_hg, row.altimeter, 0.01), _detail(
        row, f"altim ours={observation.altimeter_in_hg} awc={row.altimeter}"
    )

    yield "clouds", _clouds_match(observation.clouds, row.clouds), _detail(
        row,
        f"clouds ours={_format_clouds(observation.clouds)} awc={_format_pairs(row.clouds)}",
    )

    our_category = classify(observation).category
    category_ok = None if row.category is None else our_category == row.category
    yield "flight_category", category_ok, _detail(
        row,
        f"category ours={our_category} awc={row.category} "
        f"ceiling={observation.ceiling_ft} vis={observation.visibility_sm}",
    )


def _clouds_match(
    ours: Sequence[CloudLayer], theirs: Sequence[tuple[str, int | None]]
) -> bool | None:
    # A layer with an unknown base cannot be compared; AWC drops those rows.
    mine = [(layer.cover, layer.base_ft) for layer in ours if layer.base_ft is not None]
    upstream = list(theirs)

    if not mine and not upstream:
        return None
    if mine == upstream:
        return True
    # The cache carries at most four layers; a fifth from us is truncation.
    return len(upstream) == 4 and mine[:4] == upstream


def _close(left: float | int | None, right: float | int | None, tolerance: float) -> bool | None:
    if left is None or right is None:
        return None
    return abs(float(left) - float(right)) <= tolerance


def _detail(row: UpstreamRow, message: str) -> str:
    return f"{row.station} {row.raw} | {message}"


def _format_clouds(layers: Sequence[CloudLayer]) -> str:
    return " ".join(f"{layer.cover}{layer.base_ft}" for layer in layers) or "-"


def _format_pairs(layers: Sequence[tuple[str, int | None]]) -> str:
    return " ".join(f"{cover}{base}" for cover, base in layers) or "-"


def _render_markdown(*, rows: int, parsed: int, skipped: int, tallies: dict[str, Tally]) -> str:
    lines = [
        "# METAR cross-check",
        "",
        f"- parser: `{PARSER_VERSION}`",
        f"- generated: {datetime.now().astimezone().isoformat(timespec='seconds')}",
        f"- source: {CACHE_URL}",
        f"- observations: {parsed:,} parsed, {skipped:,} skipped, {rows:,} rows considered",
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
            f"| {name} | {tally.compared:,} | {tally.agree:,} | {tally.disagree:,} "
            f"| {tally.uncompared:,} | {tally.rate:.2%} |"
        )

    lines.append("")
    lines.append("Agreement is measured only where both decoders produced a value. `Missing`")
    lines.append("counts rows where one side had nothing, which is usually a group the other")
    lines.append("decoder does not model rather than a mistake.")
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


def _text(values: Sequence[str], position: int) -> str | None:
    if position >= len(values):
        return None
    value = values[position].strip()
    if not value or value.lower() in {"null", "none", "n/a"}:
        return None
    return value


def _number(value: str | None) -> float | None:
    """AWC writes "10+" for ten miles or more; a plain float() drops those rows."""
    if value is None:
        return None
    cleaned = value.strip().lstrip("<>").rstrip("+")
    try:
        return float(cleaned)
    except ValueError:
        return None


def _integer(value: str | None) -> int | None:
    number = _number(value)
    return None if number is None else int(number)


def _timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _normalize_cover(cover: str) -> str:
    """The cache writes vertical visibility as `OVX`; the report says `VV`."""
    return "VV" if cover == "OVX" else cover


def _is_us(station: str) -> bool:
    """ICAO K and P prefixes cover the US and its territories."""
    return len(station) == 4 and station[0] in {"K", "P"}


if __name__ == "__main__":
    raise SystemExit(main())
