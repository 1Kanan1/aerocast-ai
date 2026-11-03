"""The fact bundle the explanation layer is allowed to read.

In `domain/` on purpose: deterministic, tested, and it still works with every provider off.
Every citable value carries a `ref`, and the bundle hashes its own canonical JSON.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.domain.metar import Observation, classify
from app.domain.taf import Taf, TafPeriod
from app.domain.weather.models import CloudLayer

DEFINITION_VERSION = "defs-1.0.0"

DEFINITIONS: dict[str, str] = {
    "VFR": "Ceiling above 3,000 ft and visibility above 5 statute miles.",
    "MVFR": "Ceiling 1,000 to 3,000 ft or visibility 3 to 5 statute miles.",
    "IFR": "Ceiling 500 to under 1,000 ft or visibility 1 to under 3 statute miles.",
    "LIFR": "Ceiling under 500 ft or visibility under 1 statute mile.",
    "ceiling": "The lowest broken, overcast, or vertical visibility layer above ground.",
    "TEMPO": "Temporary fluctuations expected for less than an hour at a time.",
    "BECMG": "Conditions becoming gradually within the stated window.",
    "PROB30": "A 30 percent probability of the stated conditions.",
    "PROB40": "A 40 percent probability of the stated conditions.",
    "dewpoint_spread": "The difference between temperature and dewpoint. A small spread "
    "means the air is close to saturation and fog or low cloud becomes likely.",
    "P6SM": "Visibility greater than six statute miles. It is a floor, not a measurement.",
}


@dataclass(frozen=True, slots=True)
class BriefAdvisory:
    kind: str
    hazard: str
    valid_to: datetime
    distance_nm: float | None = None
    due_to: str | None = None


@dataclass(frozen=True, slots=True)
class BriefStation:
    icao: str
    name: str
    lat: float
    lon: float
    observation: Observation | None = None
    taf: Taf | None = None
    advisories: tuple[BriefAdvisory, ...] = ()


def build_brief(stations: Sequence[BriefStation], generated_at: datetime) -> dict[str, Any]:
    """Assemble the bundle. Same inputs and time produce the same hash."""
    bundle: dict[str, Any] = {
        "generated_at": generated_at.isoformat(),
        "definition_version": DEFINITION_VERSION,
        "stations": [_station(station, generated_at) for station in stations],
        "definitions": dict(DEFINITIONS),
    }
    bundle["brief_hash"] = _hash(bundle)
    return bundle


def refs_in(bundle: object) -> list[str]:
    """Every ref path in a bundle, for validating claims against it."""
    found: list[str] = []

    def walk(node: object) -> None:
        if isinstance(node, dict):
            ref = node.get("ref")
            if isinstance(ref, str):
                found.append(ref)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(bundle)
    return found


def _station(station: BriefStation, generated_at: datetime) -> dict[str, Any]:
    return {
        "icao": station.icao,
        "name": station.name,
        "lat": station.lat,
        "lon": station.lon,
        "metar": _metar(station, generated_at),
        "taf": _taf(station),
        "advisories": [
            _advisory(station.icao, index, item)
            for index, item in enumerate(station.advisories)
        ],
    }


def _metar(station: BriefStation, generated_at: datetime) -> dict[str, Any] | None:
    observation = station.observation
    if observation is None:
        return None

    root = ("metar", station.icao)
    category = classify(observation)

    return {
        "ref": _ref(*root),
        "raw": observation.raw,
        "observed_at": observation.observed_at.isoformat(),
        "age_seconds": max(0, int((generated_at - observation.observed_at).total_seconds())),
        "station": observation.station,
        "is_automated": observation.is_automated,
        "flight_category": {
            "ref": _ref(*root, "flight_category"),
            "value": category.category,
            "basis": category.basis,
        },
        "wind": _wind(observation, root),
        "visibility": _visibility(observation, root),
        "ceiling": {
            "ref": _ref(*root, "ceiling"),
            "ft": observation.ceiling_ft,
        },
        "clouds": [_cloud(layer) for layer in observation.clouds],
        "weather": list(observation.weather),
        "temperature": _temperature(observation, root),
        "altimeter_in_hg": observation.altimeter_in_hg,
        "remarks": observation.remarks,
    }


def _wind(observation: Observation, root: tuple[str, ...]) -> dict[str, Any] | None:
    wind = observation.wind
    if wind is None:
        return None
    return {
        "ref": _ref(*root, "wind"),
        "direction_deg": wind.direction_deg,
        "speed_kt": wind.speed_kt,
        "gust_kt": wind.gust_kt,
        "is_variable": wind.is_variable,
        "is_calm": wind.is_calm,
    }


def _visibility(observation: Observation, root: tuple[str, ...]) -> dict[str, Any] | None:
    visibility = observation.visibility
    if visibility is None:
        return None
    return {
        "ref": _ref(*root, "visibility"),
        "statute_miles": visibility.statute_miles,
        "is_greater_than": visibility.is_greater_than,
        "is_less_than": visibility.is_less_than,
    }


def _temperature(observation: Observation, root: tuple[str, ...]) -> dict[str, Any] | None:
    if observation.temperature_c is None:
        return None
    spread = None
    if observation.dewpoint_c is not None:
        spread = round(observation.temperature_c - observation.dewpoint_c, 1)
    return {
        "ref": _ref(*root, "temperature"),
        "c": observation.temperature_c,
        "dewpoint_c": observation.dewpoint_c,
        "dewpoint_spread_c": spread,
    }


def _cloud(layer: CloudLayer) -> dict[str, Any]:
    return {"cover": layer.cover, "base_ft": layer.base_ft, "cloud_type": layer.cloud_type}


def _taf(station: BriefStation) -> dict[str, Any] | None:
    taf = station.taf
    if taf is None:
        return None

    root = ("taf", station.icao)
    return {
        "ref": _ref(*root),
        "issued_at": taf.issued_at.isoformat(),
        "valid_from": taf.valid_from.isoformat(),
        "valid_to": taf.valid_to.isoformat(),
        "is_amended": taf.is_amended,
        "is_corrected": taf.is_corrected,
        "periods": [
            _taf_period(period, root, index) for index, period in enumerate(taf.periods)
        ],
    }


def _taf_period(period: TafPeriod, root: tuple[str, ...], index: int) -> dict[str, Any]:
    return {
        "ref": _ref(*root, "period", str(index)),
        "change": period.change,
        "from": period.starts_at.isoformat(),
        "to": period.ends_at.isoformat(),
        "is_temporary": period.is_temporary,
        "probability": period.probability,
        "wind": None
        if period.wind is None
        else {
            "direction_deg": period.wind.direction_deg,
            "speed_kt": period.wind.speed_kt,
            "gust_kt": period.wind.gust_kt,
        },
        "visibility_sm": period.visibility_sm,
        "ceiling_ft": period.ceiling_ft,
        "weather": list(period.weather),
        "clouds": [_cloud(layer) for layer in period.clouds],
    }


def _advisory(icao: str, index: int, advisory: BriefAdvisory) -> dict[str, Any]:
    return {
        "ref": _ref("adv", icao, str(index)),
        "kind": advisory.kind,
        "hazard": advisory.hazard,
        "valid_to": advisory.valid_to.isoformat(),
        "distance_nm": advisory.distance_nm,
        "due_to": advisory.due_to,
    }


def _ref(*parts: str) -> str:
    return ".".join(parts)


def _hash(bundle: dict[str, Any]) -> str:
    canonical = json.dumps(bundle, sort_keys=True, separators=(",", ":"), default=str)
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()
