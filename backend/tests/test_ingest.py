from datetime import UTC, datetime

from app.domain.taf import parse_taf
from app.ingest.jobs import metar_record, taf_record
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
