"""Ask-first resolution: the place a question names, or the ones it might."""

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from app.api import resolve as resolve_module
from app.main import app

NOW = datetime.now(UTC)
METAR = "METAR KSGF 012353Z 29008KT 10SM CLR 18/09 A3001 RMK AO2"

KDEN = {
    "icao": "KDEN",
    "name": "Denver International",
    "state": "CO",
    "lat": 39.86,
    "lon": -104.67,
}
KIXD = {
    "icao": "KIXD",
    "name": "Olathe/New Century Arpt",
    "state": "KS",
    "lat": 38.83,
    "lon": -94.89,
}
KOJC = {
    "icao": "KOJC",
    "name": "Johnson County Executive",
    "state": "KS",
    "lat": 38.85,
    "lon": -94.74,
}
KSGF = {
    "icao": "KSGF",
    "name": "Springfield-Branson National",
    "state": "MO",
    "lat": 37.24,
    "lon": -93.39,
}
KSPI = {
    "icao": "KSPI",
    "name": "Springfield Capital",
    "state": "IL",
    "lat": 39.84,
    "lon": -89.68,
}


class FakeDb:
    """Just enough SQL to answer the resolver's queries."""

    def __init__(
        self,
        stations: list[dict[str, Any]],
        ages: dict[str, int | None] | None = None,
    ) -> None:
        self.stations = stations
        self.ages = ages or {}
        self.queries: list[str] = []

    async def fetch_one(
        self, sql: str, params: dict[str, Any] | None = None
    ) -> dict[str, Any] | None:
        self.queries.append(sql)
        params = params or {}
        if "obs_time from metar_observations" in sql:
            age = self.ages.get(str(params.get("icao")))
            if age is None:
                return None
            return {"obs_time": NOW - timedelta(seconds=age)}
        return None

    async def fetch_all(
        self, sql: str, params: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        self.queries.append(sql)
        params = params or {}
        if "upper(icao) = any(:codes)" in sql:
            wanted = {str(code).upper() for code in params.get("codes", ())}
            return [s for s in self.stations if s["icao"].upper() in wanted]
        if "where station_icao = any(:icaos)" in sql:
            return [
                {
                    "station_icao": icao,
                    "raw": METAR,
                    "obs_time": NOW - timedelta(seconds=age),
                }
                for icao in params.get("icaos", ())
                if (age := self.ages.get(icao)) is not None
            ]
        if "join lateral" in sql:
            return [
                {**station, "obs_time": NOW - timedelta(seconds=age)}
                for station in self.stations
                if (age := self.ages.get(station["icao"])) is not None
            ]
        if "from stations" in sql and "name ilike" in sql:
            phrase = str(params["exact"]).lower()
            rows = [
                station
                for station in self.stations
                if (
                    resolve_module._matches_city_prefix(
                        station["name"], phrase
                    )
                    and (
                        "and state = :state" not in sql
                        or station["state"] == params.get("state")
                    )
                )
                or (
                    "or state = :state" in sql
                    and station["state"] == params.get("state")
                )
            ]
            return sorted(
                rows,
                key=lambda station: (
                    not resolve_module._matches_city_prefix(
                        station["name"], phrase
                    ),
                    len(station["name"]),
                    station["name"],
                ),
            )[: int(params.get("limit", 20))]
        return []


def install(monkeypatch, db: FakeDb) -> None:
    monkeypatch.setattr(resolve_module, "fetch_one", db.fetch_one)
    monkeypatch.setattr(resolve_module, "fetch_all", db.fetch_all)


async def get(path: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as client:
        return await client.get(path)


async def test_a_station_code_wins_over_everything(monkeypatch) -> None:
    install(monkeypatch, FakeDb([KDEN, KIXD], {"KIXD": 60}))

    response = await get("/api/resolve?q=what+is+the+wind+at+kixd")

    body = response.json()
    assert response.status_code == 200
    assert body["station"]["icao"] == "KIXD"
    assert body["station"]["ask"] is True
    assert body["area"] is None
    assert body["candidates"] == []


async def test_a_bare_three_letter_code_matches_case_insensitively(
    monkeypatch,
) -> None:
    install(monkeypatch, FakeDb([KDEN], {"KDEN": 60}))

    response = await get("/api/resolve?q=den")

    body = response.json()
    assert response.status_code == 200
    assert body["station"]["icao"] == "KDEN"
    assert body["station"]["ask"] is False


async def test_a_city_name_resolves_to_its_area_point(monkeypatch) -> None:
    install(monkeypatch, FakeDb([KDEN], {"KDEN": 60}))

    bare = await get("/api/resolve?q=Denver")
    bare_body = bare.json()
    assert bare_body["station"] is None
    assert bare_body["candidates"] == []
    assert bare_body["area"] == {
        "lat": 39.86,
        "lon": -104.67,
        "label": "Denver, CO",
        "ask": False,
    }

    asked = await get("/api/resolve?q=weather+in+Denver")
    asked_body = asked.json()
    assert asked_body["station"] is None
    assert asked_body["area"]["label"] == "Denver, CO"
    assert asked_body["area"]["ask"] is True


async def test_a_city_with_multiple_airports_clusters_into_an_area(
    monkeypatch,
) -> None:
    seattle_bfi = {
        "icao": "KBFI",
        "name": "Seattle/Boeing Fld",
        "state": "WA",
        "lat": 47.55,
        "lon": -122.31,
    }
    seattle_sea = {
        "icao": "KSEA",
        "name": "Seattle-Tacoma Intl",
        "state": "WA",
        "lat": 47.45,
        "lon": -122.31,
    }
    far_other = {
        "icao": "KZZZ",
        "name": "Port Seattle Far",
        "state": "CA",
        "lat": 38.0,
        "lon": -122.0,
    }
    install(
        monkeypatch,
        FakeDb([seattle_bfi, seattle_sea, far_other], {"KBFI": 60}),
    )

    response = await get("/api/resolve?q=Seattle")

    body = response.json()
    assert body["station"] is None
    assert body["candidates"] == []
    assert body["area"] == {
        "lat": 47.5,
        "lon": -122.31,
        "label": "Seattle, WA",
        "ask": False,
    }


async def test_a_city_with_state_hint_picks_that_state(monkeypatch) -> None:
    install(monkeypatch, FakeDb([KSGF, KSPI]))

    response = await get("/api/resolve?q=Springfield+IL")

    body = response.json()
    assert body["station"] is None
    assert body["candidates"] == []
    assert body["area"] == {
        "lat": 39.84,
        "lon": -89.68,
        "label": "Springfield, IL",
        "ask": False,
    }


async def test_an_unmatched_place_says_so(monkeypatch) -> None:
    install(monkeypatch, FakeDb([KDEN]))

    response = await get("/api/resolve?q=weather+in+Atlantis")

    body = response.json()
    assert body["station"] is None
    assert body["area"] is None
    assert body["candidates"] == []
    assert "No station or city matches" in body["message"]


async def test_a_follow_up_question_stays_with_the_station(
    monkeypatch,
) -> None:
    college_station = {
        "icao": "KCLL",
        "name": "College Station/Easterwood Arpt",
        "state": "TX",
        "lat": 30.59,
        "lon": -96.36,
    }
    install(monkeypatch, FakeDb([KDEN, college_station], {"KDEN": 60}))

    for query in (
        "What+was+its+temperature+in+the+last+24+hours%3F",
        "What+is+the+temperature+at+each+station%3F",
    ):
        response = await get(f"/api/resolve?q={query}")
        body = response.json()
        assert body["station"] is None
        assert body["area"] is None
        assert body["candidates"] == []

    explicit = await get("/api/resolve?q=College+Station")
    assert explicit.json()["area"]["label"] == "College Station, TX"


async def test_city_sharing_a_state_name_resolves_to_the_city(
    monkeypatch,
) -> None:
    ny_state = [
        {
            "icao": f"KNY{i}",
            "name": f"Town {i}",
            "state": "NY",
            "lat": 42.5 + i * 0.1,
            "lon": -75.0,
        }
        for i in range(8)
    ]
    kjfk = {
        "icao": "KJFK",
        "name": "New York/JF Kennedy Intl",
        "state": "NY",
        "lat": 40.64,
        "lon": -73.76,
    }
    install(monkeypatch, FakeDb([*ny_state, kjfk]))

    for query in ("new+york", "new+york+new+york", "new+york+city"):
        response = await get(f"/api/resolve?q={query}")
        body = response.json()
        assert body["area"] == {
            "lat": 40.64,
            "lon": -73.76,
            "label": "New York, NY",
            "ask": False,
        }


async def test_a_stale_station_suggests_a_fresh_neighbour(monkeypatch) -> None:
    install(
        monkeypatch,
        FakeDb(
            [KIXD, KOJC],
            {"KIXD": 4 * 24 * 3600, "KOJC": 600},
        ),
    )

    suggested = await resolve_module.suggestions(
        {"icao": "KIXD", "lat": KIXD["lat"], "lon": KIXD["lon"]},
        await resolve_module.latest_age("KIXD", NOW),
        NOW,
    )

    assert [item["icao"] for item in suggested] == ["KOJC"]
    assert suggested[0]["distance_nm"] < 10
    assert suggested[0]["age_seconds"] == 600


def test_the_place_phrase_prefers_what_follows_a_locator() -> None:
    assert resolve_module._phrases("What is the weather in Denver?")[0] == (
        "denver",
        None,
    )
    assert resolve_module._phrases("wind at new york")[0] == ("new york", None)
    assert resolve_module._phrases("Springfield, IL")[0] == (
        "springfield",
        "IL",
    )
    assert resolve_module._phrases("KIXD tomorrow")[0] == ("kixd", None)


async def test_code_lookup_batches_all_words_into_one_query(
    monkeypatch,
) -> None:
    db = FakeDb([KDEN, KIXD], {"KDEN": 60, "KIXD": 60})
    install(monkeypatch, db)

    response = await get(
        "/api/resolve?q=compare+wind+near+kixd+and+kden+this+hour"
    )

    assert response.status_code == 200
    assert response.json()["station"]["icao"] == "KIXD"
    code_queries = [q for q in db.queries if "upper(icao) = any(:codes)" in q]
    assert len(code_queries) == 1
