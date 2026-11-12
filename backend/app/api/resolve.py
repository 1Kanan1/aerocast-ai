"""Resolve a free-text question to a station, or to the stations it might mean.

Ask-first has to guess which airport a question is about before any model
call. The guess is deliberately conservative: an exact ICAO wins, a place
name that matches several stations comes back as candidates, and a place
that matches none says so instead of picking one.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Query

from app.api import models
from app.api.stations import station_metar
from app.db.session import fetch_all, fetch_one
from app.domain.geo import distance_nm

router = APIRouter(prefix="/api", tags=["resolve"])

STATION_COLUMNS = "icao, name, state, lat, lon"

#: Never return more than a short list; beyond this the user should refine.
CANDIDATE_LIMIT = 6

#: One suggested alternative is enough to cover a dead feed.
SUGGESTION_LIMIT = 2

METAR_STALE_SECONDS = 90 * 60
NEARBY_NM = 50.0

#: Degrees of latitude per nautical mile, near enough for a 50 nm search.
NM_PER_DEGREE = 60.0

_LATITUDE_PAD = NEARBY_NM / NM_PER_DEGREE + 0.5
_LONGITUDE_PAD = _LATITUDE_PAD

_WORD = re.compile(r"[a-z0-9]+")

_STOPWORDS = frozenset(
    {
        "about",
        "after",
        "ago",
        "all",
        "and",
        "any",
        "are",
        "at",
        "average",
        "back",
        "be",
        "been",
        "before",
        "being",
        "between",
        "briefing",
        "can",
        "ceiling",
        "change",
        "changed",
        "changes",
        "clouds",
        "compare",
        "comparison",
        "condition",
        "conditions",
        "could",
        "current",
        "currently",
        "day",
        "days",
        "did",
        "do",
        "does",
        "done",
        "during",
        "earlier",
        "for",
        "forecast",
        "from",
        "had",
        "has",
        "have",
        "here",
        "history",
        "hour",
        "hours",
        "how",
        "if",
        "in",
        "is",
        "it",
        "its",
        "last",
        "later",
        "maybe",
        "me",
        "mean",
        "metar",
        "might",
        "must",
        "my",
        "near",
        "next",
        "now",
        "of",
        "or",
        "over",
        "past",
        "please",
        "previous",
        "recent",
        "recently",
        "report",
        "reported",
        "should",
        "show",
        "since",
        "taf",
        "temp",
        "temperature",
        "tell",
        "that",
        "the",
        "there",
        "these",
        "this",
        "those",
        "to",
        "today",
        "tomorrow",
        "trend",
        "trends",
        "visibility",
        "was",
        "weather",
        "week",
        "weeks",
        "were",
        "what",
        "when",
        "will",
        "wind",
        "winds",
        "with",
        "would",
    }
)

#: Words that usually introduce the place a question is about.
_LOCATORS = frozenset({"at", "around", "for", "from", "in", "near", "over"})

_STATE_NAMES = {
    "alabama": "AL",
    "alaska": "AK",
    "arizona": "AZ",
    "arkansas": "AR",
    "california": "CA",
    "colorado": "CO",
    "connecticut": "CT",
    "delaware": "DE",
    "florida": "FL",
    "georgia": "GA",
    "hawaii": "HI",
    "idaho": "ID",
    "illinois": "IL",
    "indiana": "IN",
    "iowa": "IA",
    "kansas": "KS",
    "kentucky": "KY",
    "louisiana": "LA",
    "maine": "ME",
    "maryland": "MD",
    "massachusetts": "MA",
    "michigan": "MI",
    "minnesota": "MN",
    "mississippi": "MS",
    "missouri": "MO",
    "montana": "MT",
    "nebraska": "NE",
    "nevada": "NV",
    "new hampshire": "NH",
    "new jersey": "NJ",
    "new mexico": "NM",
    "new york": "NY",
    "north carolina": "NC",
    "north dakota": "ND",
    "ohio": "OH",
    "oklahoma": "OK",
    "oregon": "OR",
    "pennsylvania": "PA",
    "rhode island": "RI",
    "south carolina": "SC",
    "south dakota": "SD",
    "tennessee": "TN",
    "texas": "TX",
    "utah": "UT",
    "vermont": "VT",
    "virginia": "VA",
    "washington": "WA",
    "west virginia": "WV",
    "wisconsin": "WI",
    "wyoming": "WY",
}


@router.get("/resolve", response_model=models.ResolveResponse)
async def resolve(
    q: str = Query(min_length=1, max_length=400),
) -> dict[str, Any]:
    """The station a question names, the ones it might mean, or a message."""
    code = await _by_code(q)
    if code is not None:
        return await _resolved(code)

    for phrase in _phrases(q):
        rows = await _by_place(phrase)
        if not rows:
            continue

        if len(rows) == 1:
            return await _resolved(rows[0])

        state = _STATE_NAMES.get(phrase)
        if state is not None and all(
            phrase not in row["name"].lower() for row in rows
        ):
            return _empty(
                f"{phrase.title()} has many stations. Name a city or an "
                "airport code."
            )

        return {
            "station": None,
            "candidates": [
                await _candidate(row) for row in rows[:CANDIDATE_LIMIT]
            ],
            "suggested": [],
            "message": f"\u201c{phrase}\u201d matches several stations.",
        }

    return _empty("No station matches that question. Try an airport code.")


def _phrases(question: str) -> list[str]:
    """Place guesses: the tail after a locator, then the content words."""
    words = _WORD.findall(question.lower())

    phrases: list[str] = []
    for index in range(len(words) - 1, -1, -1):
        if words[index] not in _LOCATORS:
            continue
        tail = [
            word
            for word in words[index + 1 :]
            if word not in _STOPWORDS and len(word) >= 3
        ]
        if tail:
            phrases.append(" ".join(tail))
        break

    content = [
        word for word in words if word not in _STOPWORDS and len(word) >= 3
    ]
    if content:
        phrases.append(" ".join(content))
    phrases.extend(sorted(set(content), key=len, reverse=True))

    seen: set[str] = set()
    unique: list[str] = []
    for phrase in phrases:
        if phrase in seen:
            continue
        seen.add(phrase)
        unique.append(phrase)
    return unique


async def _by_code(question: str) -> dict[str, Any] | None:
    for token in _WORD.findall(question.lower()):
        if not 3 <= len(token) <= 5:
            continue
        row = await fetch_one(
            f"select {STATION_COLUMNS} from stations where icao = :icao",
            {"icao": token.upper()},
        )
        if row is not None:
            return row
    return None


async def _by_place(phrase: str) -> list[dict[str, Any]]:
    state = _STATE_NAMES.get(phrase)
    # A TAF is the best proxy we have for "the airport people mean": the
    # larger fields have one, and a weather office never does.
    order = (
        "order by exists ("
        "  select 1 from taf_forecasts t where t.station_icao = stations.icao"
        ") desc, (name ilike :prefix) desc, length(name), name"
    )
    if state is None:
        sql = (
            f"select {STATION_COLUMNS} from stations "
            "where name ilike :pattern and name not ilike '%WFO%' "
            f"{order} limit :limit"
        )
        params: dict[str, Any] = {
            "pattern": f"%{phrase}%",
            "prefix": f"{phrase}%",
            "limit": CANDIDATE_LIMIT + 1,
        }
    else:
        sql = (
            f"select {STATION_COLUMNS} from stations "
            "where (name ilike :pattern or state = :state) "
            "and name not ilike '%WFO%' "
            f"{order} limit :limit"
        )
        params = {
            "pattern": f"%{phrase}%",
            "prefix": f"{phrase}%",
            "state": state,
            "limit": CANDIDATE_LIMIT + 1,
        }

    return await fetch_all(sql, params)


async def _resolved(row: dict[str, Any]) -> dict[str, Any]:
    age = await latest_age(row["icao"])
    return {
        "station": _place(row),
        "candidates": [],
        "suggested": await suggestions(row, age),
        "message": None,
    }


def _empty(message: str) -> dict[str, Any]:
    return {
        "station": None,
        "candidates": [],
        "suggested": [],
        "message": message,
    }


def _place(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "icao": row["icao"],
        "name": row["name"],
        "state": row["state"],
        "lat": row["lat"],
        "lon": row["lon"],
    }


async def _candidate(row: dict[str, Any]) -> dict[str, Any]:
    """A place, plus the report that would tell the two apart."""
    observation = await fetch_one(
        "select raw, obs_time from metar_observations "
        "where station_icao = :icao order by obs_time desc limit 1",
        {"icao": row["icao"].upper()},
    )
    return {**_place(row), "metar": station_metar(row, observation)}


async def latest_age(icao: str) -> int | None:
    """Seconds since the newest observation, or None if there is none."""
    row = await fetch_one(
        "select obs_time from metar_observations "
        "where station_icao = :icao order by obs_time desc limit 1",
        {"icao": icao.upper()},
    )
    if row is None:
        return None
    return int((datetime.now(UTC) - row["obs_time"]).total_seconds())


async def suggestions(
    station: dict[str, Any],
    age_seconds: int | None,
) -> list[dict[str, Any]]:
    """Fresh stations near one whose observation is stale or missing."""
    if age_seconds is not None and age_seconds <= METAR_STALE_SECONDS:
        return []

    lat = station["lat"]
    lon = station["lon"]
    rows = await fetch_all(
        "select s.icao, s.name, s.state, s.lat, s.lon, o.obs_time "
        "from stations s join lateral ("
        "  select obs_time from metar_observations m "
        "  where m.station_icao = s.icao order by obs_time desc limit 1"
        ") o on true "
        "where s.icao <> :icao "
        "and s.lat between :min_lat and :max_lat "
        "and s.lon between :min_lon and :max_lon",
        {
            "icao": station["icao"],
            "min_lat": lat - _LATITUDE_PAD,
            "max_lat": lat + _LATITUDE_PAD,
            "min_lon": lon - _LONGITUDE_PAD,
            "max_lon": lon + _LONGITUDE_PAD,
        },
    )

    now = datetime.now(UTC)
    fresh: list[dict[str, Any]] = []
    for row in rows:
        age = int((now - row["obs_time"]).total_seconds())
        if age > METAR_STALE_SECONDS:
            continue
        distance = distance_nm(lat, lon, row["lat"], row["lon"])
        if distance > NEARBY_NM:
            continue
        fresh.append(
            {
                **_place(row),
                "distance_nm": round(distance, 1),
                "age_seconds": age,
            }
        )

    return sorted(fresh, key=lambda item: item["distance_nm"])[
        :SUGGESTION_LIMIT
    ]
