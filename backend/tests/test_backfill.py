"""First-open history: a station with holes gets filled before it is drawn."""

from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest

from app.ingest import backfill as module
from app.ingest.backfill import ensure_history, needs_history

NOW = datetime(2026, 11, 19, 15, 0, tzinfo=UTC)


def rows(hours: range) -> list[dict[str, Any]]:
    return [{"obs_time": NOW - timedelta(hours=hour)} for hour in hours]


@pytest.fixture(autouse=True)
def fresh_attempts(monkeypatch):
    monkeypatch.setattr(module, "_attempted", {})


def test_a_day_of_reports_is_dense_enough() -> None:
    assert needs_history(rows(range(24)), NOW) is False


def test_a_handful_of_reports_is_a_hole() -> None:
    assert needs_history(rows(range(2)), NOW) is True
    assert needs_history([], NOW) is True


async def test_a_thin_station_is_loaded_once() -> None:
    calls: list[str] = []
    clock = [0.0]

    async def loader(icao: str) -> None:
        calls.append(icao)

    first = await ensure_history(
        "KSEA", [], 48, now=NOW, clock=lambda: clock[0], loader=loader
    )
    clock[0] = 1.0
    again = await ensure_history(
        "KSEA", [], 48, now=NOW, clock=lambda: clock[0], loader=loader
    )

    assert first is True
    assert again is False
    assert calls == ["KSEA"]


async def test_a_dense_station_is_not_loaded() -> None:
    calls: list[str] = []

    async def loader(icao: str) -> None:
        calls.append(icao)

    loaded = await ensure_history(
        "KSEA", rows(range(24)), 48, now=NOW, loader=loader
    )

    assert loaded is False
    assert calls == []


async def test_a_short_window_does_not_load() -> None:
    calls: list[str] = []

    async def loader(icao: str) -> None:
        calls.append(icao)

    loaded = await ensure_history("KSEA", [], 6, now=NOW, loader=loader)

    assert loaded is False
    assert calls == []


async def test_a_failed_load_is_swallowed_and_waited_out() -> None:
    calls: list[str] = []
    clock = [0.0]

    async def loader(icao: str) -> None:
        calls.append(icao)
        raise RuntimeError("upstream down")

    assert (
        await ensure_history(
            "KSEA", [], 48, now=NOW, clock=lambda: clock[0], loader=loader
        )
        is False
    )

    clock[0] = module.RETRY_SECONDS - 1
    await ensure_history(
        "KSEA", [], 48, now=NOW, clock=lambda: clock[0], loader=loader
    )
    assert calls == ["KSEA"]

    clock[0] = module.RETRY_SECONDS + 1
    await ensure_history(
        "KSEA", [], 48, now=NOW, clock=lambda: clock[0], loader=loader
    )
    assert calls == ["KSEA", "KSEA"]


async def test_backfill_encodes_query_and_skips_unrequested_stations(
    monkeypatch,
) -> None:
    urls: list[str] = []
    inserted: list[list[dict[str, Any]]] = []

    def fake_download(url: str, attempts: int, timeout: float) -> bytes:
        urls.append(url)
        return (
            b'[{"reportTime":"2026-11-19T14:56:00Z",'
            b'"rawOb":"METAR KSFO 191456Z 27010KT 10SM CLR 15/10 A3000",'
            b'"fltCat":"VFR"},'
            b'{"reportTime":"2026-11-19T14:56:00Z",'
            b'"rawOb":"METAR KOTH 191456Z 27010KT 10SM CLR 15/10 A3000",'
            b'"fltCat":"VFR"}]'
        )

    class FakeConnection:
        async def execute(self, stmt, records):
            inserted.append(records)

    monkeypatch.setattr(module, "download", fake_download)

    count = await module.backfill(cast(Any, FakeConnection()), ["KSFO"], 48)

    assert count == 1
    assert urls == [
        "https://aviationweather.gov/api/data/metar?format=json&ids=KSFO&hours=48"
    ]
    assert [row["station_icao"] for row in inserted[0]] == ["KSFO"]
