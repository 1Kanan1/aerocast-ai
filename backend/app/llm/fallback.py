"""Deterministic answer used when the model fails validation.

The summary is a plain template over the same bundle, and the notice
says a generated explanation was not available without using the words
"invalid" or "error". The facts are never at fault here.
"""

from __future__ import annotations

from app.llm.contract import Answer

NOTICE = (
    "Showing the decoded facts for this station. A generated explanation "
    "wasn't available for this question."
)


def fallback_answer(bundle: object) -> Answer:
    return Answer(
        summary=template_summary(bundle),
        claims=(),
        caveats=(),
        refusal=None,
        notice=NOTICE,
    )


def template_summary(bundle: object) -> str:
    station = _first_station(bundle)
    if station is None:
        return "No station data is available for this question."

    icao = station.get("icao")
    name = icao if isinstance(icao, str) else "The station"

    metar = station.get("metar")
    if not isinstance(metar, dict):
        return f"{name} has no observation on file."

    facts: list[str] = []

    category = _get(metar, "flight_category", "value")
    if isinstance(category, str):
        facts.append(f"{category} conditions")

    ceiling = metar.get("ceiling")
    if isinstance(ceiling, dict):
        height = ceiling.get("ft")
        if isinstance(height, int | float):
            facts.append(f"ceiling {height:,.0f} ft")
        else:
            facts.append("no ceiling")

    visibility = _get(metar, "visibility", "statute_miles")
    if isinstance(visibility, int | float):
        facts.append(f"visibility {visibility:g} SM")

    wind = metar.get("wind")
    if isinstance(wind, dict):
        described = _wind(wind)
        if described is not None:
            facts.append(described)

    if not facts:
        return f"{name} has an observation but no decoded values."

    summary = f"{name} is reporting {', '.join(facts)}."
    age = metar.get("age_seconds")
    if isinstance(age, int):
        summary += " " + _age(age)
    return summary


def _wind(wind: dict[str, object]) -> str | None:
    if wind.get("is_calm"):
        return "calm wind"

    speed = wind.get("speed_kt")
    if not isinstance(speed, int | float):
        return None

    direction = wind.get("direction_deg")
    if wind.get("is_variable") or not isinstance(direction, int | float):
        described = f"wind variable at {speed:g} kt"
    else:
        described = f"wind {direction:03.0f}° at {speed:g} kt"

    gust = wind.get("gust_kt")
    if isinstance(gust, int | float):
        described += f", gusting {gust:g} kt"
    return described


def _age(seconds: int) -> str:
    if seconds < 90:
        return "Observed moments ago."
    if seconds < 3600:
        return f"Observed {seconds // 60} min ago."
    return f"Observed {seconds // 3600} h ago."


def _first_station(bundle: object) -> dict[str, object] | None:
    if not isinstance(bundle, dict):
        return None
    stations = bundle.get("stations")
    if not isinstance(stations, list) or not stations:
        return None
    first = stations[0]
    return first if isinstance(first, dict) else None


def _get(node: dict[str, object], *path: str) -> object:
    current: object = node
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current
