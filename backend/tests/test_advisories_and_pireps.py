from datetime import UTC, datetime

from app.sources.awc.advisories import read_gairmets, read_sigmets
from app.sources.awc.pireps import read_pireps

GAIRMET: dict[str, object] = {
    "tag": "3W",
    "hazard": "LLWS",
    "severity": None,
    "base": None,
    "top": None,
    "due_to": "AIR SPEED LOSS",
    "geom": "LINE",
    "validTime": "2026-11-04T09:00:00.000Z",
    "expireTime": 1793545200,
    "coords": [
        {"lat": "56.96", "lon": "-93.33"},
        {"lat": "56.86", "lon": "-92.78"},
        {"lat": "56.96", "lon": "-93.33"},
    ],
    "product": "ZULU",
}

SIGMET: dict[str, object] = {
    "seriesId": "1",
    "firId": "KZNY",
    "hazard": "CONVECTIVE",
    "qualifier": "SEV",
    "rawSigmet": "KZNY SIGMET 1",
    "geom": "AREA",
    "validTimeFrom": 1793522700,
    "validTimeTo": 1793545200,
    "coords": [
        {"lat": "40.1", "lon": "-75.2"},
        {"lat": "40.4", "lon": "-74.9"},
        {"lat": "40.7", "lon": "-75.5"},
    ],
}

PIREP: dict[str, object] = {
    "icaoId": "KMSC",
    "obsTime": 1793817660,
    "lat": 42.8721,
    "lon": -87.9469,
    "fltLvl": 55,
    "pirepType": "PIREP",
    "clouds": [{"cover": "BKN", "base": 2500, "top": 4200}],
    "tbInt1": "LGT",
    "tbType1": "CAT",
    "tbBas1": 18000,
    "tbTop1": 24000,
    "rawOb": "MKE UA /OV MKE210005/TM 1841/FL055/TP E120/SK BKN025-TOP042",
}


def test_gairmet_becomes_a_labelled_line() -> None:
    (advisory,) = read_gairmets([GAIRMET])

    assert advisory.kind == "gairmet"
    assert advisory.source_id == "ZULU:3W"
    assert advisory.valid_from == datetime(2026, 11, 4, 9, 0, tzinfo=UTC)
    assert advisory.valid_to.tzinfo is not None
    assert advisory.geometry["type"] == "LineString"


def test_sigmet_becomes_a_closed_polygon() -> None:
    (advisory,) = read_sigmets([SIGMET])

    ring = advisory.geometry["coordinates"]

    assert advisory.kind == "sigmet"
    assert advisory.geometry["type"] == "Polygon"
    assert isinstance(ring, list)
    assert ring[0] == ring[-1]


def test_advisories_without_a_geometry_are_skipped() -> None:
    assert list(read_gairmets([{**GAIRMET, "coords": []}])) == []


def test_pirep_summarises_the_groups_it_has() -> None:
    (report,) = read_pireps([PIREP])

    assert report.station == "KMSC"
    assert report.altitude_ft == 55
    assert report.clouds == "BKN2500"
    assert report.turbulence == "CATLGT 18000-24000"
    assert report.icing is None


def test_pirep_without_a_timestamp_is_skipped() -> None:
    assert list(read_pireps([{**PIREP, "obsTime": None}])) == []
