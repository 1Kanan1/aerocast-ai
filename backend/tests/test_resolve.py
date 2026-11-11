"""Ask-first resolution: the place a question names, or the ones it might."""

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from app.api import resolve as resolve_module
from app.main import app

NOW = datetime.now(UTC)

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

    async def fetch_one(
        self, sql: str, params: dict[str, Any] | None = None
    ) -> dict[str, Any] | None:
        params = params or {}
        if "where icao = :icao" in sql:
            for station in self.stations:
                if station["icao"] == params.get("icao"):
                    return station
            return None
        if "obs_time from metar_observations" in sql:
            age = self.ages.get(str(params.get("icao")))
            if age is None:
                return None
            return {"obs_time": NOW - timedelta(seconds=age)}
        return None

    async def fetch_all(
        self, sql: str, params: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        params = params or {}
        if "join lateral" in sql:
            return [
                {**station, "obs_time": NOW - timedelta(seconds=age)}
                for station in self.stations
                if (age := self.ages.get(station["icao"])) is not None
            ]
        if "from stations" in sql and "name ilike" in sql:
            phrase = str(params["pattern"]).strip("%").lower()
            rows = [
                station
                for station in self.stations
                if phrase in station["name"].lower()
                or (
                    "state = :state" in sql
                    and station["state"] == params.get("state")
                )
            ]
            return sorted(
                rows,
                key=lambda station: (
                    not station["name"].lower().startswith(phrase),
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

    response = await get("/api/resolve?q=what+is+the+wind+at+KIXD")

    body = response.json()
    assert response.status_code == 200
    assert body["station"]["icao"] == "KIXD"
    assert body["candidates"] == []


async def test_a_place_with_one_match_resolves(monkeypatch) -> None:
    install(monkeypatch, FakeDb([KDEN], {"KDEN": 60}))

    response = await get("/api/resolve?q=weather+in+Denver")

    body = response.json()
    assert body["station"]["icao"] == "KDEN"
    assert body["candidates"] == []


async def test_a_city_with_two_airports_asks_which(monkeypatch) -> None:
    install(
        monkeypatch,
        FakeDb([KSGF, KSPI], {"KSGF": 60, "KSPI": 60}),
    )

    response = await get("/api/resolve?q=weather+in+Springfield")

    body = response.json()
    assert body["station"] is None
    assert {item["icao"] for item in body["candidates"]} == {"KSGF", "KSPI"}
    assert body["message"] is not None


async def test_an_unmatched_place_says_so(monkeypatch) -> None:
    install(monkeypatch, FakeDb([KDEN]))

    response = await get("/api/resolve?q=weather+in+Atlantis")

    body = response.json()
    assert body["station"] is None
    assert body["candidates"] == []
    assert "No station matches" in body["message"]


async def test_a_follow_up_question_stays_with_the_station(
    monkeypatch,
) -> None:
    install(monkeypatch, FakeDb([KDEN], {"KDEN": 60}))

    response = await get(
        "/api/resolve?q=What+was+its+temperature+in+the+last+24+hours%3F"
    )

    body = response.json()
    assert body["station"] is None
    assert body["candidates"] == []


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
        await resolve_module.latest_age("KIXD"),
    )

    assert [item["icao"] for item in suggested] == ["KOJC"]
    assert suggested[0]["distance_nm"] < 10
    assert suggested[0]["age_seconds"] == 600


def test_the_place_phrase_prefers_what_follows_a_locator() -> None:
    assert resolve_module._phrases("What is the weather in Denver?")[0] == (
        "denver"
    )
    assert resolve_module._phrases("wind at new york")[0] == "new york"
    assert resolve_module._phrases("KIXD tomorrow")[0] == "kixd"
