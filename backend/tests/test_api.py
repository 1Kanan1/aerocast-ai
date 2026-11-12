"""Contract tests for the API surface, with the database faked."""

from datetime import UTC, datetime
from typing import Any

import httpx

from app.api import area as area_module
from app.api import ask as ask_module
from app.api import stations as stations_module
from app.api import weather as weather_module
from app.llm.client import Completion
from app.llm.guardrails import fixed_refusal
from app.main import app

OBSERVED_AT = datetime(2026, 11, 1, 8, 56, tzinfo=UTC)
ISSUED_AT = datetime(2026, 11, 1, 8, 59, tzinfo=UTC)
VALID_FROM = datetime(2026, 11, 1, 9, 0, tzinfo=UTC)
VALID_TO = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)
FETCHED_AT = datetime(2026, 11, 1, 9, 0, tzinfo=UTC)

METAR = (
    "METAR KSFO 010856Z 27009KT 7SM RA FEW018 BKN024 OVC030 12/10 A2985 "
    "RMK AO2 T01220100"
)
TAF = (
    "TAF KSFO 010859Z 0109/0212 30005KT 6SM -SHRA OVC035 "
    "FM011300 32007KT P6SM BKN050"
)

KSFO = {
    "icao": "KSFO",
    "name": "San Francisco Intl",
    "state": "CA",
    "lat": 37.6196,
    "lon": -122.3656,
    "elev_m": 4,
}
KJFK = {
    "icao": "KJFK",
    "name": "John F Kennedy Intl",
    "state": "NY",
    "lat": 40.6398,
    "lon": -73.7789,
    "elev_m": 4,
}

METAR_ROW = {
    "station_icao": "KSFO",
    "obs_time": OBSERVED_AT,
    "report_time": None,
    "raw": METAR,
    "decoded": {"station": "KSFO"},
    "category": "MVFR",
    "upstream_category": "MVFR",
    "parse_status": "ok",
    "parser_version": "metar-1.1.0",
    "fetched_at": FETCHED_AT,
}

TAF_ROW = {
    "station_icao": "KSFO",
    "issue_time": ISSUED_AT,
    "valid_from": VALID_FROM,
    "valid_to": VALID_TO,
    "raw": TAF,
    "periods": [{"change": "INITIAL"}],
    "parser_version": "taf-1.0.0",
    "fetched_at": FETCHED_AT,
}

ADVISORY = {
    "kind": "gairmet",
    "source_id": "ZULU:3W",
    "hazard": "IFR",
    "severity": None,
    "base_ft": None,
    "top_ft": None,
    "due_to": "CEILING AND VISIBILITY",
    "valid_from": VALID_FROM,
    "valid_to": VALID_TO,
    "geom": {
        "type": "Polygon",
        "coordinates": [
            [
                [-122.5, 37.5],
                [-122.2, 37.5],
                [-122.2, 37.8],
                [-122.5, 37.5],
            ]
        ],
    },
}

FAR_ADVISORY = {
    **ADVISORY,
    "source_id": "ZULU:4W",
    "geom": {
        "type": "Polygon",
        "coordinates": [
            [
                [-73.9, 40.5],
                [-73.6, 40.5],
                [-73.6, 40.8],
                [-73.9, 40.5],
            ]
        ],
    },
}

PIREP = {
    "report_time": OBSERVED_AT,
    "station_icao": "KMSC",
    "lat": 42.8721,
    "lon": -87.9469,
    "altitude_ft": 55,
    "kind": "UA",
    "turbulence": "CATLGT 18000-24000",
    "icing": None,
    "clouds": "BKN2500",
}


class FakeDb:
    """Answers the statements the routers issue, keyed on the table."""

    def __init__(self, tables: dict[str, list[dict[str, Any]]]) -> None:
        self.tables = tables

    def _rows(self, sql: str) -> list[dict[str, Any]]:
        for table in (
            "metar_observations",
            "taf_forecasts",
            "advisories",
            "pireps",
            "stations",
        ):
            if f"from {table}" in sql:
                return self.tables.get(table, [])
        raise AssertionError(f"unexpected statement: {sql}")

    async def fetch_one(
        self, sql: str, params: dict[str, object] | None = None
    ) -> dict[str, Any] | None:
        rows = self._rows(sql)
        return rows[0] if rows else None

    async def fetch_all(
        self, sql: str, params: dict[str, object] | None = None
    ) -> list[dict[str, Any]]:
        rows = self._rows(sql)
        if params and "min_lat" in params:
            rows = [
                row
                for row in rows
                if params["min_lat"] <= row["lat"] <= params["max_lat"]
                and params["min_lon"] <= row["lon"] <= params["max_lon"]
            ]
        return rows


def install(monkeypatch, **tables: list[dict[str, Any]]) -> None:
    defaults = {
        "stations": [KSFO, KJFK],
        "metar_observations": [METAR_ROW],
        "taf_forecasts": [TAF_ROW],
        "advisories": [ADVISORY, FAR_ADVISORY],
        "pireps": [PIREP],
    }
    db = FakeDb({**defaults, **tables})
    monkeypatch.setattr(stations_module, "fetch_all", db.fetch_all)
    monkeypatch.setattr(stations_module, "fetch_one", db.fetch_one)
    monkeypatch.setattr(weather_module, "fetch_all", db.fetch_all)

    async def no_scope(*args: object, **kwargs: object) -> None:
        return None

    # The scope check is a provider call; tests never make one.
    monkeypatch.setattr(ask_module, "classify_scope", no_scope)
    monkeypatch.setattr(area_module, "classify_scope", no_scope)


async def get(path: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as client:
        return await client.get(path)


async def post(path: str, body: dict[str, object]) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as client:
        return await client.post(path, json=body)


async def test_station_search_wraps_its_rows(monkeypatch) -> None:
    install(monkeypatch)

    response = await get("/api/stations?q=sfo")

    body = response.json()
    assert response.status_code == 200
    assert body["meta"]["source"] == "awc stations"
    assert [station["icao"] for station in body["data"]] == ["KSFO", "KJFK"]


async def test_near_lists_the_stations_inside_the_box(
    monkeypatch,
) -> None:
    install(monkeypatch)

    response = await get("/api/stations/near?lat=37.62&lon=-122.4")

    body = response.json()
    assert response.status_code == 200
    assert [station["icao"] for station in body["data"]] == ["KSFO"]
    assert body["data"][0]["distance_nm"] < 3


async def test_near_drops_a_station_past_the_radius(monkeypatch) -> None:
    # Inside the degrees the query searches, but 95 nm from the click.
    distant = {**KSFO, "icao": "KFAR", "name": "Far Field", "lat": 39.2}
    install(monkeypatch, stations=[KSFO, distant])

    response = await get("/api/stations/near?lat=37.62&lon=-122.4")

    body = response.json()
    assert [station["icao"] for station in body["data"]] == ["KSFO"]


async def test_station_detail_joins_reports_and_nearby_advisories(
    monkeypatch,
) -> None:
    install(monkeypatch)

    response = await get("/api/stations/KSFO")

    body = response.json()
    assert response.status_code == 200
    assert body["data"]["station"]["icao"] == "KSFO"
    assert body["data"]["metar"]["raw"] == METAR
    assert body["data"]["taf"]["issue_time"].startswith("2026-11-01T08:59")
    assert [item["source_id"] for item in body["data"]["advisories"]] == [
        "ZULU:3W"
    ]
    assert body["data"]["advisories"][0]["distance_nm"] == 0.0


async def test_unknown_station_answers_404(monkeypatch) -> None:
    install(monkeypatch, stations=[])

    response = await get("/api/stations/KZZZ")

    assert response.status_code == 404


async def test_history_returns_the_timeline(monkeypatch) -> None:
    install(monkeypatch)

    response = await get("/api/stations/KSFO/observations?hours=6")

    body = response.json()
    assert response.status_code == 200
    assert body["data"][0]["category"] == "MVFR"
    assert body["meta"]["observed_at"].startswith("2026-11-01T08:56")


async def test_map_layers_keeps_what_the_viewport_contains(
    monkeypatch,
) -> None:
    install(monkeypatch)

    response = await get("/api/map/layers?bbox=-123,37,-122,38")

    body = response.json()
    assert [item["source_id"] for item in body["data"]["advisories"]] == [
        "ZULU:3W"
    ]


async def test_map_layers_without_a_bbox_covers_the_world(
    monkeypatch,
) -> None:
    install(monkeypatch)

    response = await get("/api/map/layers")

    body = response.json()
    assert [item["source_id"] for item in body["data"]["advisories"]] == [
        "ZULU:3W",
        "ZULU:4W",
    ]


async def test_map_layers_rejects_a_malformed_bbox(monkeypatch) -> None:
    install(monkeypatch)

    response = await get("/api/map/layers?bbox=-123,37,-122")

    assert response.status_code == 400


async def test_advisories_are_listed_active_only(monkeypatch) -> None:
    install(monkeypatch)

    response = await get("/api/advisories?kind=gairmet")

    body = response.json()
    assert response.status_code == 200
    assert len(body["data"]) == 2


async def test_pireps_are_recent_reports(monkeypatch) -> None:
    install(monkeypatch)

    response = await get("/api/pireps?hours=1")

    body = response.json()
    assert body["data"][0]["station_icao"] == "KMSC"


async def test_brief_is_a_citable_bundle(monkeypatch) -> None:
    install(monkeypatch)

    response = await get("/api/stations/KSFO/brief")

    bundle = response.json()["data"]
    assert response.status_code == 200
    assert str(bundle["brief_hash"]).startswith("sha256:")
    assert bundle["stations"][0]["metar"]["ref"] == "metar.KSFO"
    assert bundle["stations"][0]["metar"]["wind"]["speed_kt"] == 9
    assert bundle["stations"][0]["taf"]["periods"][0]["change"] == "INITIAL"
    assert bundle["stations"][0]["advisories"][0]["ref"] == "adv.KSFO.0"
    assert "MVFR" in bundle["definitions"]


async def test_brief_answers_404_for_an_unknown_station(monkeypatch) -> None:
    install(monkeypatch, stations=[])

    response = await get("/api/stations/KZZZ/brief")

    assert response.status_code == 404


async def test_every_endpoint_publishes_a_response_schema() -> None:
    """An untyped endpoint would generate `unknown` in the frontend."""
    schema = (await get("/api/openapi.json")).json()

    for path, operations in schema["paths"].items():
        for operation in operations.values():
            content = operation["responses"]["200"]["content"]
            assert content["application/json"]["schema"], path


async def test_openapi_points_the_brief_at_the_bundle_schema() -> None:
    schema = (await get("/api/openapi.json")).json()
    operation = schema["paths"]["/api/stations/{icao}/brief"]["get"]
    reference = operation["responses"]["200"]["content"]["application/json"]
    name = reference["schema"]["$ref"].rsplit("/", 1)[-1]

    assert name in schema["components"]["schemas"]


KOAK = {
    "icao": "KOAK",
    "name": "Oakland Intl",
    "state": "CA",
    "lat": 37.7213,
    "lon": -122.2207,
    "elev_m": 2,
}


def completion(payload: dict[str, object]) -> Completion:
    return Completion(
        payload=payload,
        provider="test",
        model="test-model",
        latency_ms=5,
    )


def grounded_answer() -> dict[str, object]:
    return {
        "summary": "KSFO is MVFR.",
        "claims": [
            {
                "text": "The ceiling is 2,400 ft.",
                "refs": ["metar.KSFO.ceiling"],
            }
        ],
        "caveats": [],
        "refusal_kind": None,
    }


async def test_ask_returns_a_validated_answer(monkeypatch) -> None:
    install(monkeypatch)

    async def fake_complete(*args: object, **kwargs: object):
        return completion(grounded_answer())

    monkeypatch.setattr(ask_module, "complete", fake_complete)

    response = await post(
        "/api/ask", {"icao": "KSFO", "question": "What is the ceiling?"}
    )

    body = response.json()
    assert response.status_code == 200
    assert body["summary"] == "KSFO is MVFR."
    assert body["claims"][0]["refs"] == ["metar.KSFO.ceiling"]
    assert body["notice"] is None


async def test_ask_refuses_a_verdict_without_a_model(monkeypatch) -> None:
    install(monkeypatch)

    async def fail(*args: object, **kwargs: object):
        raise AssertionError("a verdict question must not reach a model")

    monkeypatch.setattr(ask_module, "complete", fail)

    response = await post(
        "/api/ask", {"icao": "KSFO", "question": "Is it safe to fly?"}
    )

    body = response.json()
    assert response.status_code == 200
    assert body["refusal"]
    assert body["claims"] == []


async def test_ask_refuses_out_of_scope_before_the_answer(monkeypatch) -> None:
    install(monkeypatch)

    async def off_topic(*args: object, **kwargs: object) -> bool:
        return False

    async def fail(*args: object, **kwargs: object):
        raise AssertionError("an off-topic question must not reach the model")

    monkeypatch.setattr(ask_module, "classify_scope", off_topic)
    monkeypatch.setattr(ask_module, "complete", fail)

    response = await post(
        "/api/ask", {"icao": "KSFO", "question": "Who won the game?"}
    )

    body = response.json()
    assert response.status_code == 200
    assert body["refusal"] == fixed_refusal("out_of_scope")
    assert body["claims"] == []


async def test_ask_answers_when_the_scope_check_has_no_opinion(
    monkeypatch,
) -> None:
    install(monkeypatch)

    async def unsure(*args: object, **kwargs: object) -> None:
        return None

    async def fake_complete(*args: object, **kwargs: object):
        return completion(grounded_answer())

    monkeypatch.setattr(ask_module, "classify_scope", unsure)
    monkeypatch.setattr(ask_module, "complete", fake_complete)

    response = await post(
        "/api/ask", {"icao": "KSFO", "question": "What is the ceiling?"}
    )

    assert response.status_code == 200
    assert response.json()["claims"]


async def test_a_bare_station_code_is_answered_without_the_scope_check(
    monkeypatch,
) -> None:
    install(monkeypatch)

    async def fail(*args: object, **kwargs: object):
        raise AssertionError("a station code must not be classified")

    async def fake_complete(*args: object, **kwargs: object):
        return completion(grounded_answer())

    monkeypatch.setattr(ask_module, "classify_scope", fail)
    monkeypatch.setattr(ask_module, "complete", fake_complete)

    response = await post("/api/ask", {"icao": "KSFO", "question": "KSFO"})

    assert response.status_code == 200
    assert response.json()["refusal"] is None


async def test_area_gathers_the_stations_around_a_point(monkeypatch) -> None:
    install(monkeypatch, stations=[KSFO, KOAK, KJFK])

    response = await get("/api/area?lat=37.62&lon=-122.4")

    body = response.json()["data"]
    assert response.status_code == 200
    assert [station["icao"] for station in body["stations"]] == [
        "KSFO",
        "KOAK",
    ]
    assert body["radius_nm"] == 15
    assert body["brief"]["stations"][1]["metar"]["ref"] == "metar.KOAK"


async def test_area_ask_uses_every_station_in_the_prompt(monkeypatch) -> None:
    install(monkeypatch, stations=[KSFO, KOAK])
    seen: dict[str, object] = {}

    async def fake_complete(*args: object, **kwargs: object):
        seen["messages"] = args[1]
        return completion(
            {
                "summary": "The two airports disagree on visibility.",
                "claims": [
                    {
                        "text": "KOAK reports visibility 7 SM.",
                        "refs": ["metar.KOAK.visibility"],
                    }
                ],
                "caveats": [],
                "refusal_kind": None,
            }
        )

    monkeypatch.setattr(ask_module, "complete", fake_complete)

    response = await post(
        "/api/area/ask",
        {"lat": 37.62, "lon": -122.4, "question": "What is the visibility?"},
    )

    assert response.status_code == 200
    assert response.json()["refusal"] is None

    messages = seen["messages"]
    assert isinstance(messages, list)
    system = messages[0]["content"]
    payload = messages[-1]["content"]
    assert "Several stations are in scope" in system
    assert "metar.KSFO" in payload
    assert "metar.KOAK" in payload


async def test_area_ask_says_when_nothing_is_near(monkeypatch) -> None:
    install(monkeypatch)

    response = await post(
        "/api/area/ask",
        {"lat": 30, "lon": -60, "question": "What is the wind?"},
    )

    assert response.status_code == 404


async def test_ask_falls_back_when_the_answer_is_invented(monkeypatch) -> None:
    install(monkeypatch)
    invented: dict[str, object] = {
        "summary": "KSFO is MVFR.",
        "claims": [
            {
                "text": "The ceiling is 12,000 ft.",
                "refs": ["metar.KSFO.ceiling"],
            }
        ],
        "caveats": [],
        "refusal_kind": None,
    }

    async def fake_complete(*args: object, **kwargs: object):
        return completion(invented)

    monkeypatch.setattr(ask_module, "complete", fake_complete)

    response = await post(
        "/api/ask", {"icao": "KSFO", "question": "What is the ceiling?"}
    )

    body = response.json()
    assert response.status_code == 200
    assert body["notice"]
    assert body["claims"] == []
    assert "KSFO is reporting" in body["summary"]


async def test_ask_falls_back_when_every_provider_is_down(monkeypatch) -> None:
    install(monkeypatch)

    async def fake_complete(*args: object, **kwargs: object):
        return None

    monkeypatch.setattr(ask_module, "complete", fake_complete)

    response = await post(
        "/api/ask", {"icao": "KSFO", "question": "What is the ceiling?"}
    )

    body = response.json()
    assert response.status_code == 200
    assert body["notice"]
    assert body["notice"].startswith("Showing the decoded facts")


async def test_ask_rejects_a_blank_question(monkeypatch) -> None:
    install(monkeypatch)

    response = await post("/api/ask", {"icao": "KSFO", "question": "   "})

    assert response.status_code == 422


async def test_ask_answers_404_for_an_unknown_station(monkeypatch) -> None:
    install(monkeypatch, stations=[])

    response = await post(
        "/api/ask", {"icao": "KZZZ", "question": "What is the ceiling?"}
    )

    assert response.status_code == 404
