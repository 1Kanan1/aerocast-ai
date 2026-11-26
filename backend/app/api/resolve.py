"""Resolve a free-text question to a station or a city area.

Ask-first resolves the place before any model call: an ICAO code selects
that station, a city name opens the area around its location as if clicked
on the map, and an unmatched place says so.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Query

from app.api import models
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
        "active",
        "advisories",
        "advisory",
        "after",
        "afternoon",
        "age",
        "ago",
        "airport",
        "airports",
        "all",
        "altimeter",
        "and",
        "any",
        "are",
        "area",
        "around",
        "at",
        "average",
        "back",
        "be",
        "been",
        "before",
        "being",
        "between",
        "both",
        "briefing",
        "broken",
        "can",
        "ceiling",
        "ceilings",
        "change",
        "changed",
        "changes",
        "clear",
        "closest",
        "cloud",
        "clouds",
        "coldest",
        "compare",
        "comparison",
        "condition",
        "conditions",
        "could",
        "current",
        "currently",
        "day",
        "days",
        "depart",
        "describe",
        "dewpoint",
        "did",
        "different",
        "do",
        "does",
        "doing",
        "done",
        "during",
        "each",
        "earlier",
        "evening",
        "every",
        "explain",
        "few",
        "flight",
        "fly",
        "flying",
        "fog",
        "for",
        "forecast",
        "forecasts",
        "from",
        "give",
        "going",
        "gust",
        "gusting",
        "gusts",
        "had",
        "has",
        "have",
        "haze",
        "here",
        "high",
        "highest",
        "history",
        "hour",
        "hours",
        "how",
        "humidity",
        "icing",
        "if",
        "ifr",
        "in",
        "individual",
        "is",
        "it",
        "its",
        "land",
        "last",
        "later",
        "lifr",
        "like",
        "list",
        "local",
        "low",
        "lowest",
        "max",
        "maybe",
        "me",
        "mean",
        "metar",
        "might",
        "min",
        "mist",
        "morning",
        "must",
        "mvfr",
        "my",
        "near",
        "nearby",
        "nearest",
        "next",
        "night",
        "notam",
        "notams",
        "now",
        "of",
        "old",
        "or",
        "outside",
        "over",
        "overcast",
        "past",
        "please",
        "point",
        "pressure",
        "previous",
        "rain",
        "recent",
        "recently",
        "remarks",
        "report",
        "reported",
        "reports",
        "safe",
        "same",
        "scattered",
        "should",
        "show",
        "since",
        "sky",
        "snow",
        "stale",
        "station",
        "stations",
        "storm",
        "storms",
        "summarize",
        "summary",
        "taf",
        "tafs",
        "temp",
        "temperature",
        "temperatures",
        "tell",
        "tfr",
        "tfrs",
        "that",
        "the",
        "there",
        "these",
        "this",
        "those",
        "to",
        "today",
        "tomorrow",
        "tonight",
        "trend",
        "trends",
        "turbulence",
        "vfr",
        "visibility",
        "warmest",
        "was",
        "weather",
        "week",
        "weeks",
        "were",
        "what",
        "when",
        "where",
        "which",
        "who",
        "why",
        "will",
        "wind",
        "windiest",
        "winds",
        "with",
        "would",
    }
)

#: Words that only count as part of a place name when preceded by another word.
_PLACE_SUFFIXES = frozenset({"city", "point", "station"})

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


#: Stations within this radius of the top city match form its area centroid.
CITY_CLUSTER_NM = 15.0

_STATE_ABBRS = frozenset(_STATE_NAMES.values())


@router.get("/resolve", response_model=models.ResolveResponse)
async def resolve(
    q: str = Query(min_length=1, max_length=400),
) -> dict[str, Any]:
    """The station or city area a question names, or a message."""
    code = await _by_code(q)
    if code is not None:
        return await _resolved(code, ask=len(_WORD.findall(q)) > 1)

    words = _WORD.findall(q.lower())
    for phrase, state_hint in _phrases(q):
        rows = await _by_place(phrase, state_hint=state_hint)
        if not rows:
            continue

        state = _STATE_NAMES.get(phrase)
        named = [
            row for row in rows if _matches_city_prefix(row["name"], phrase)
        ]
        if state is not None and state_hint is None and not named:
            return _empty(
                f"{phrase.title()} has many stations. Name a city or an "
                "airport code."
            )

        pool = named or rows
        return _resolved_area(phrase, pool, words, state_hint=state_hint)

    return _empty(
        "No station or city matches that question. Try a station code "
        "(KSFO) or city name."
    )


def _phrases(question: str) -> list[tuple[str, str | None]]:
    """Place guesses: locator tail, then content words, with state hint."""
    words = _WORD.findall(question.lower())

    def split_state(tokens: list[str]) -> tuple[str, str | None]:
        if len(tokens) >= 2 and tokens[-1].upper() in _STATE_ABBRS:
            return " ".join(tokens[:-1]), tokens[-1].upper()
        for tail_len in (2, 1):
            if len(tokens) > tail_len:
                candidate = " ".join(tokens[-tail_len:])
                if candidate in _STATE_NAMES:
                    return (
                        " ".join(tokens[:-tail_len]),
                        _STATE_NAMES[candidate],
                    )
        return " ".join(tokens), None

    def subphrases(tokens: list[str]) -> list[tuple[str, str | None]]:
        out: list[tuple[str, str | None]] = [split_state(tokens)]
        for size in range(min(3, len(tokens) - 1), 1, -1):
            for start in range(len(tokens) - size + 1):
                out.append((" ".join(tokens[start : start + size]), None))
        return out

    def keep(tokens: list[str]) -> list[str]:
        kept: list[str] = []
        for index, word in enumerate(tokens):
            is_trailing_state = (
                index == len(tokens) - 1
                and len(kept) >= 1
                and word.upper() in _STATE_ABBRS
            )
            is_place_suffix = len(kept) >= 1 and word in _PLACE_SUFFIXES
            if (
                is_trailing_state
                or is_place_suffix
                or (word not in _STOPWORDS and len(word) >= 3)
            ):
                kept.append(word)
        return kept

    phrases: list[tuple[str, str | None]] = []
    for index in range(len(words) - 1, -1, -1):
        if words[index] not in _LOCATORS:
            continue
        tail = keep(words[index + 1 :])
        if tail:
            phrases.extend(subphrases(tail))
        break

    content = keep(words)
    if content:
        phrases.extend(subphrases(content))
    for word in sorted(
        {w for w in content if w not in _STOPWORDS and len(w) >= 3},
        key=len,
        reverse=True,
    ):
        phrases.append((word, None))

    seen: set[tuple[str, str | None]] = set()
    unique: list[tuple[str, str | None]] = []
    for item in phrases:
        if not item[0] or item in seen:
            continue
        seen.add(item)
        unique.append(item)
    return unique


async def _by_code(question: str) -> dict[str, Any] | None:
    tokens = _WORD.findall(question.lower())
    codes: list[str] = []
    for token in tokens:
        if 3 <= len(token) <= 5 and token not in _STOPWORDS:
            upper = token.upper()
            if upper not in codes:
                codes.append(upper)
            if len(tokens) == 1 and len(token) == 3:
                prefixed = f"K{upper}"
                if prefixed not in codes:
                    codes.append(prefixed)
    if not codes:
        return None
    rows = await fetch_all(
        f"select {STATION_COLUMNS} from stations "
        "where upper(icao) = any(:codes)",
        {"codes": codes},
    )
    by_icao = {row["icao"].upper(): row for row in rows}
    for code in codes:
        if code in by_icao:
            return by_icao[code]
    return None


def _matches_city_prefix(name: str, phrase: str) -> bool:
    """True when a station name starts with the city phrase at a boundary."""
    lowered = name.lower()
    if not lowered.startswith(phrase):
        return False
    if len(lowered) == len(phrase):
        return True
    return lowered[len(phrase)] in (" ", "/", "-", ",")


async def _by_place(
    phrase: str, *, state_hint: str | None = None
) -> list[dict[str, Any]]:
    state = state_hint or _STATE_NAMES.get(phrase)
    # Match city names at the start of station names on a delimiter boundary
    # so words like "station" never match "College Station/Easterwood Arpt".
    prefix_match = (
        "(name ilike :exact or name ilike :sp or name ilike :sl "
        "or name ilike :hy or name ilike :cm)"
    )
    # City-prefix matches always rank ahead of state-only matches so "New York"
    # and "Washington" resolve to the city rather than shorter airports in the
    # same state. A TAF is the best proxy for the primary airport in a city.
    order = (
        f"order by ({prefix_match}) desc, exists ("
        "  select 1 from taf_forecasts t where t.station_icao = stations.icao"
        ") desc, length(name), name"
    )
    params: dict[str, object] = {
        "exact": phrase,
        "sp": f"{phrase} %",
        "sl": f"{phrase}/%",
        "hy": f"{phrase}-%",
        "cm": f"{phrase},%",
        "limit": CANDIDATE_LIMIT + 1,
    }
    if state_hint is not None:
        sql = (
            f"select {STATION_COLUMNS} from stations "
            f"where {prefix_match} and state = :state "
            "and name not ilike '%WFO%' "
            f"{order} limit :limit"
        )
        params["state"] = state_hint
    elif state is None:
        sql = (
            f"select {STATION_COLUMNS} from stations "
            f"where {prefix_match} and name not ilike '%WFO%' "
            f"{order} limit :limit"
        )
    else:
        sql = (
            f"select {STATION_COLUMNS} from stations "
            f"where ({prefix_match} or state = :state) "
            "and name not ilike '%WFO%' "
            f"{order} limit :limit"
        )
        params["state"] = state

    return await fetch_all(sql, params)


def _resolved_area(
    phrase: str,
    rows: list[dict[str, Any]],
    words: list[str],
    *,
    state_hint: str | None = None,
) -> dict[str, Any]:
    anchor = rows[0]
    cluster = [
        row
        for row in rows
        if distance_nm(anchor["lat"], anchor["lon"], row["lat"], row["lon"])
        <= CITY_CLUSTER_NM
    ]
    lat = round(sum(row["lat"] for row in cluster) / len(cluster), 4)
    lon = round(sum(row["lon"] for row in cluster) / len(cluster), 4)
    state_code = anchor.get("state")
    label = f"{phrase.title()}, {state_code}" if state_code else phrase.title()
    base = phrase.split()
    bare_forms = [base, [*base, "city"]]
    if state_hint is not None:
        bare_forms.append([*base, state_hint.lower()])
        for full_name, abbr in _STATE_NAMES.items():
            if abbr == state_hint:
                bare_forms.append([*base, *full_name.split()])
    return {
        "station": None,
        "area": {
            "lat": lat,
            "lon": lon,
            "label": label,
            "ask": words not in bare_forms,
        },
        "candidates": [],
        "suggested": [],
        "message": None,
    }


async def _resolved(
    row: dict[str, Any], *, ask: bool = True
) -> dict[str, Any]:
    now = datetime.now(UTC)
    age = await latest_age(row["icao"], now)
    return {
        "station": {**_place(row), "ask": ask},
        "area": None,
        "candidates": [],
        "suggested": await suggestions(row, age, now),
        "message": None,
    }


def _empty(message: str) -> dict[str, Any]:
    return {
        "station": None,
        "area": None,
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


async def latest_age(icao: str, now: datetime) -> int | None:
    """Seconds since the newest observation, or None if there is none."""
    row = await fetch_one(
        "select obs_time from metar_observations "
        "where station_icao = :icao order by obs_time desc limit 1",
        {"icao": icao.upper()},
    )
    if row is None:
        return None
    return int((now - row["obs_time"]).total_seconds())


async def suggestions(
    station: dict[str, Any],
    age_seconds: int | None,
    now: datetime,
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
