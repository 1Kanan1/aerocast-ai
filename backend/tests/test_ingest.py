import asyncio
import contextlib
import json
import threading
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any, cast

from app.domain.taf import parse_taf
from app.ingest import jobs as jobs_module
from app.ingest import scheduler as scheduler_module
from app.ingest.jobs import (
    ingest_stations,
    metar_record,
    run_job,
    taf_record,
)
from app.sources.awc.metars import UpstreamMetar
from app.sources.awc.tafs import UpstreamForecast, UpstreamTaf

NOW = datetime(2026, 11, 4, 12, 0, tzinfo=UTC)


def upstream_metar(**overrides: object) -> UpstreamMetar:
    defaults: dict[str, object] = {
        "raw": "METAR KSFO 041156Z 27009KT 7SM BKN024 12/10 A2985",
        "station": "KSFO",
        "observed_at": datetime(2026, 11, 4, 11, 56, tzinfo=UTC),
        "temperature": 12.2,
        "dewpoint": 10.0,
        "wind_direction": 270,
        "wind_speed": 9,
        "wind_gust": None,
        "visibility": 7.0,
        "altimeter": 29.85,
        "clouds": (("BKN", 2400),),
        "category": "MVFR",
    }
    defaults.update(overrides)
    return UpstreamMetar(**defaults)  # type: ignore[arg-type]


def test_metar_record_carries_the_parse_and_the_upstream_category() -> None:
    record = metar_record(upstream_metar(), NOW)

    assert record is not None
    assert record["station_icao"] == "KSFO"
    assert record["category"] == "MVFR"
    assert record["upstream_category"] == "MVFR"
    assert record["parse_status"] == "ok"


def test_the_stored_decode_carries_the_fields_the_timeline_reads() -> None:
    record = metar_record(upstream_metar(), NOW)

    assert record is not None
    decoded = json.loads(str(record["decoded"]))
    assert {
        "altimeter_in_hg",
        "clouds",
        "dewpoint_c",
        "temperature_c",
        "visibility",
        "weather",
        "wind",
    } <= decoded.keys()
    assert {
        "direction_deg",
        "gust_kt",
        "is_variable",
        "speed_kt",
    } <= decoded["wind"].keys()
    assert {
        "is_greater_than",
        "is_less_than",
        "statute_miles",
    } <= decoded["visibility"].keys()


def test_metar_record_flags_a_category_disagreement() -> None:
    record = metar_record(upstream_metar(category="VFR"), NOW)

    assert record is not None
    assert record["category"] == "MVFR"
    assert record["parse_status"] == "mismatch"


def test_unparseable_metar_is_skipped() -> None:
    assert metar_record(upstream_metar(raw="NOT A METAR"), NOW) is None


def test_taf_record_keeps_the_parsed_periods() -> None:
    row = UpstreamTaf(
        raw="TAF KSFO 041130Z 0412/0512 27009KT P6SM SKC",
        station="KSFO",
        issued_at=datetime(2026, 11, 4, 11, 30, tzinfo=UTC),
        forecasts=(
            UpstreamForecast(
                starts_at=None,
                ends_at=None,
                change="INITIAL",
                wind_direction=270,
                wind_speed=9,
                visibility=6.0,
                clouds=(),
            ),
        ),
    )

    record = taf_record(row, NOW)

    assert record is not None
    assert record["station_icao"] == "KSFO"
    assert (
        record["valid_from"]
        == parse_taf(row.raw, reference=row.issued_at).valid_from
    )
    assert '"change": "INITIAL"' in str(record["periods"])


def test_unparseable_taf_is_skipped() -> None:
    row = UpstreamTaf(
        raw="TAF KSFO NIL",
        station="KSFO",
        issued_at=None,
        forecasts=(),
    )

    assert taf_record(row, NOW) is None


async def test_run_job_rolls_back_before_unlocking_and_recording_an_error():
    class FakeConnection:
        def __init__(self) -> None:
            self.aborted = False
            self.rolled_back = False
            self.committed = False
            self.statements: list[tuple[str, object]] = []

        async def scalar(self, stmt, params=None):
            return True

        async def execute(self, stmt, params=None):
            if self.aborted:
                raise RuntimeError("current transaction is aborted")
            self.statements.append((str(stmt), params))

        async def rollback(self) -> None:
            self.aborted = False
            self.rolled_back = True

        async def commit(self) -> None:
            self.committed = True

    connection = FakeConnection()

    class FakeEngine:
        @asynccontextmanager
        async def connect(self):
            yield connection

    async def failing_job(conn, now):
        conn.aborted = True
        raise RuntimeError("sql failed")

    rows = await run_job(cast(Any, FakeEngine()), "metars", failing_job)

    assert rows == 0
    assert connection.rolled_back is True
    assert connection.committed is True
    assert any("pg_advisory_unlock" in sql for sql, _ in connection.statements)
    run_params = [
        params
        for sql, params in connection.statements
        if "ingest_runs" in sql and isinstance(params, dict)
    ]
    assert len(run_params) == 1
    assert run_params[0]["status"] == "error"


async def test_scheduler_survives_a_failed_job(monkeypatch) -> None:
    seen: list[str] = []

    async def fake_run_job(engine, name, job):
        seen.append(name)
        if name == "first":
            raise RuntimeError("db down")
        return 0

    async def stop_sleep(_: float) -> None:
        raise asyncio.CancelledError

    monkeypatch.setattr(
        scheduler_module,
        "JOBS",
        (("first", 60, fake_run_job), ("second", 60, fake_run_job)),
    )
    monkeypatch.setattr(scheduler_module, "run_job", fake_run_job)
    monkeypatch.setattr(asyncio, "sleep", stop_sleep)

    with contextlib.suppress(asyncio.CancelledError):
        await scheduler_module.run_forever(cast(Any, None))

    assert seen == ["first", "second"]


async def test_ingest_downloads_in_a_worker_thread(monkeypatch) -> None:
    main_thread = threading.get_ident()
    download_threads: list[int] = []

    def fake_download(url: str) -> bytes:
        download_threads.append(threading.get_ident())
        return b"[]"

    class FakeConnection:
        async def execute(self, stmt, params=None):
            raise AssertionError("empty payload should not execute SQL")

    monkeypatch.setattr(jobs_module, "download", fake_download)

    count = await ingest_stations(cast(Any, FakeConnection()), NOW)

    assert count == 0
    assert download_threads and download_threads[0] != main_thread
