"""The fact bundle the explanation layer is allowed to read.

In `domain/` on purpose: deterministic, tested, and it still works with
every provider off. Every citable value carries a `ref`, and the bundle
hashes its own canonical JSON.
"""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from app.domain.metar import Observation, classify
from app.domain.taf import Taf, TafPeriod
from app.domain.weather.humidity import relative_humidity_pct
from app.domain.weather.models import CloudLayer

DEFINITION_VERSION = "defs-1.2.0"

#: Maximum observation checkpoints kept in a station's history summary.
MAX_HISTORY_CHECKPOINTS = 8

#: Maximum TAF issuances detailed in a station's forecast history summary.
MAX_TAF_HISTORY_ISSUANCES = 6

#: History lookback window relative to the newest observation or forecast.
HISTORY_WINDOW = timedelta(hours=48)

DEFINITIONS: dict[str, str] = {
    "VFR": "Ceiling above 3,000 ft and visibility above 5 statute miles.",
    "MVFR": "Ceiling 1,000 to 3,000 ft or visibility 3 to 5 statute miles.",
    "IFR": (
        "Ceiling 500 to under 1,000 ft or visibility 1 to under 3 "
        "statute miles."
    ),
    "LIFR": "Ceiling under 500 ft or visibility under 1 statute mile.",
    "ceiling": (
        "The lowest broken, overcast, or vertical visibility layer above "
        "ground."
    ),
    "TEMPO": (
        "Temporary fluctuations expected for less than an hour at a time."
    ),
    "BECMG": "Conditions becoming gradually within the stated window.",
    "PROB30": "A 30 percent probability of the stated conditions.",
    "PROB40": "A 40 percent probability of the stated conditions.",
    "dewpoint_spread": (
        "The difference between temperature and dewpoint. A small spread "
        "means the air is close to saturation and fog becomes likely."
    ),
    "humidity": (
        "Relative humidity as a percent of saturation, computed from the "
        "report's own temperature and dewpoint."
    ),
    "P6SM": (
        "Visibility greater than six statute miles. It is a floor, not a "
        "measurement."
    ),
    "METAR": (
        "Routine aviation surface weather observation reported at an airport, "
        "typically every hour."
    ),
    "SPECI": (
        "Special unscheduled surface weather observation issued when "
        "conditions change significantly."
    ),
    "TAF": (
        "Terminal Aerodrome Forecast for expected weather within 5 statute "
        "miles of an airport, typically covering 24 to 30 hours."
    ),
    "FM": (
        "From: marks a rapid change to new prevailing forecast conditions "
        "starting at the stated UTC time."
    ),
    "FEW": (
        "Few clouds covering 1 to 2 oktas of the sky; does not form a ceiling."
    ),
    "SCT": (
        "Scattered clouds covering 3 to 4 oktas of the sky; does not form a "
        "ceiling."
    ),
    "BKN": (
        "Broken clouds covering 5 to 7 oktas of the sky; the lowest broken "
        "layer forms a ceiling."
    ),
    "OVC": "Overcast clouds covering 8 oktas of the sky; forms a ceiling.",
    "SKC": "Sky clear: no clouds reported.",
    "CLR": "Clear below 12,000 ft at an automated station.",
    "VV": (
        "Vertical visibility into an obscured sky such as fog or snow; "
        "counts as a ceiling."
    ),
    "CB": (
        "Cumulonimbus cloud associated with thunderstorms, turbulence, and "
        "gusty winds."
    ),
    "TCU": "Towering cumulus cloud indicating strong vertical development.",
    "BR": "Mist reducing visibility to between 5/8 and 6 statute miles.",
    "FG": "Fog reducing visibility to less than 5/8 statute mile.",
    "HZ": "Haze from suspended dry particles reducing visibility.",
    "RA": "Rain; prefixed with - for light or + for heavy.",
    "SH": "Showers, such as SHRA (rain showers) or SHSN (snow showers).",
    "SN": "Snow; prefixed with - for light or + for heavy.",
    "TS": (
        "Thunderstorm; VCTS means thunderstorms in the vicinity (5 to 10 "
        "statute miles)."
    ),
    "G-AIRMET": (
        "Graphical AIRMET advisory for widespread IFR, mountain obscuration, "
        "turbulence, icing, low-level wind shear, or strong surface winds."
    ),
    "SIGMET": (
        "Significant Meteorological Information advisory for severe weather "
        "such as severe icing, severe turbulence, volcanic ash, or convective "
        "thunderstorms."
    ),
    "LLWS": (
        "Low-level wind shear: sudden change in wind speed or direction near "
        "the surface."
    ),
    "altimeter": (
        "Local barometric pressure setting in inches of mercury (inHg) used "
        "to calibrate aircraft altimeters."
    ),
    "AO2": (
        "Automated surface observing station equipped with a precipitation "
        "discriminator."
    ),
    "KT": "Knots (nautical miles per hour), the unit for aviation wind speed.",
    "SM": "Statute miles, the US unit for aviation surface visibility.",
    "UTC": (
        "Coordinated Universal Time (Zulu / Z), the standard time zone for "
        "METAR and TAF timestamps."
    ),
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
    distance_nm: float | None = None
    history: tuple[Observation, ...] = ()
    taf_history: tuple[Taf, ...] = ()


def build_brief(
    stations: Sequence[BriefStation], generated_at: datetime
) -> dict[str, Any]:
    """Assemble the bundle. Same facts produce the same hash across time."""
    bundle: dict[str, Any] = {
        "generated_at": generated_at.isoformat(),
        "definition_version": DEFINITION_VERSION,
        "stations": [_station(station, generated_at) for station in stations],
        "area_summary": _area_summary(stations),
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
        "distance_nm": station.distance_nm,
        "metar": _metar(station, generated_at),
        "taf": _taf(station),
        "advisories": [
            _advisory(station.icao, index, item)
            for index, item in enumerate(station.advisories)
        ],
        "history": _history(station),
        "taf_history": _taf_history(station),
    }


def _metar(
    station: BriefStation, generated_at: datetime
) -> dict[str, Any] | None:
    observation = station.observation
    if observation is None:
        return None

    root = ("metar", station.icao)
    category = classify(observation)
    age_seconds = max(
        0, int((generated_at - observation.observed_at).total_seconds())
    )

    return {
        "ref": _ref(*root),
        "raw": observation.raw,
        "observed_at": observation.observed_at.isoformat(),
        "age_seconds": age_seconds,
        "age_minutes": age_seconds // 60,
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
        "humidity": _humidity(observation, root),
        "altimeter_in_hg": observation.altimeter_in_hg,
        "remarks": observation.remarks,
    }


def _wind(
    observation: Observation, root: tuple[str, ...]
) -> dict[str, Any] | None:
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


def _visibility(
    observation: Observation, root: tuple[str, ...]
) -> dict[str, Any] | None:
    visibility = observation.visibility
    if visibility is None:
        return None
    return {
        "ref": _ref(*root, "visibility"),
        "statute_miles": visibility.statute_miles,
        "is_greater_than": visibility.is_greater_than,
        "is_less_than": visibility.is_less_than,
    }


def _temperature(
    observation: Observation, root: tuple[str, ...]
) -> dict[str, Any] | None:
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


def _humidity(
    observation: Observation, root: tuple[str, ...]
) -> dict[str, Any] | None:
    percent = relative_humidity_pct(
        observation.temperature_c, observation.dewpoint_c
    )
    if percent is None:
        return None
    return {"ref": _ref(*root, "humidity"), "relative_pct": percent}


def _cloud(layer: CloudLayer) -> dict[str, Any]:
    return {
        "cover": layer.cover,
        "base_ft": layer.base_ft,
        "cloud_type": layer.cloud_type,
    }


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
            _taf_period(period, root, index)
            for index, period in enumerate(taf.periods)
        ],
    }


def _taf_period(
    period: TafPeriod, root: tuple[str, ...], index: int
) -> dict[str, Any]:
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


def _advisory(
    icao: str, index: int, advisory: BriefAdvisory
) -> dict[str, Any]:
    return {
        "ref": _ref("adv", icao, str(index)),
        "kind": advisory.kind,
        "hazard": advisory.hazard,
        "valid_to": advisory.valid_to.isoformat(),
        "distance_nm": advisory.distance_nm,
        "due_to": advisory.due_to,
    }


def _history(station: BriefStation) -> dict[str, Any] | None:
    if not station.history:
        return None

    by_time = {obs.observed_at: obs for obs in station.history}
    ordered = sorted(by_time.values(), key=lambda obs: obs.observed_at)
    cutoff = ordered[-1].observed_at - HISTORY_WINDOW
    window = [obs for obs in ordered if obs.observed_at >= cutoff]

    categories: dict[str, int] = {}
    ceilings: list[int] = []
    visibilities: list[float] = []
    winds: list[int] = []
    temps: list[float] = []
    tagged: list[tuple[Observation, str | None]] = []

    for obs in window:
        cat = classify(obs).category
        tagged.append((obs, cat))
        if cat is not None:
            categories[cat] = categories.get(cat, 0) + 1
        if obs.ceiling_ft is not None:
            ceilings.append(obs.ceiling_ft)
        if obs.visibility is not None and (
            obs.visibility.statute_miles is not None
        ):
            visibilities.append(obs.visibility.statute_miles)
        if obs.wind is not None:
            if obs.wind.speed_kt is not None:
                winds.append(obs.wind.speed_kt)
            if obs.wind.gust_kt is not None:
                winds.append(obs.wind.gust_kt)
        if obs.temperature_c is not None:
            temps.append(obs.temperature_c)

    return {
        "ref": _ref("history", station.icao),
        "observation_count": len(window),
        "window_start": window[0].observed_at.isoformat(),
        "window_end": window[-1].observed_at.isoformat(),
        "category_counts": categories,
        "ceiling_ft_min": min(ceilings) if ceilings else None,
        "ceiling_ft_max": max(ceilings) if ceilings else None,
        "visibility_sm_min": min(visibilities) if visibilities else None,
        "visibility_sm_max": max(visibilities) if visibilities else None,
        "max_wind_kt": max(winds) if winds else None,
        "temperature_c_min": min(temps) if temps else None,
        "temperature_c_max": max(temps) if temps else None,
        "checkpoints": [
            _checkpoint(obs, cat) for obs, cat in _select_checkpoints(tagged)
        ],
    }


def _select_checkpoints(
    tagged: list[tuple[Observation, str | None]],
) -> list[tuple[Observation, str | None]]:
    if len(tagged) <= MAX_HISTORY_CHECKPOINTS:
        return tagged

    picked = [tagged[0]]
    prev_cat = tagged[0][1]
    for item in tagged[1:-1]:
        if item[1] != prev_cat:
            picked.append(item)
            prev_cat = item[1]
    picked.append(tagged[-1])

    if len(picked) <= MAX_HISTORY_CHECKPOINTS:
        return picked

    span = len(picked) - 1
    last = MAX_HISTORY_CHECKPOINTS - 1
    indices = sorted({round(i * span / last) for i in range(last + 1)})
    return [picked[i] for i in indices]


def _checkpoint(obs: Observation, category: str | None) -> dict[str, Any]:
    return {
        "observed_at": obs.observed_at.isoformat(),
        "flight_category": category,
        "ceiling_ft": obs.ceiling_ft,
        "visibility_sm": (
            obs.visibility.statute_miles
            if obs.visibility is not None
            else None
        ),
        "wind_speed_kt": obs.wind.speed_kt if obs.wind is not None else None,
        "wind_gust_kt": obs.wind.gust_kt if obs.wind is not None else None,
        "temperature_c": obs.temperature_c,
        "weather": list(obs.weather),
    }


def _taf_history(station: BriefStation) -> dict[str, Any] | None:
    if not station.taf_history:
        return None

    by_time = {taf.issued_at: taf for taf in station.taf_history}
    ordered = sorted(by_time.values(), key=lambda taf: taf.issued_at)
    cutoff = ordered[-1].issued_at - HISTORY_WINDOW
    window = [taf for taf in ordered if taf.issued_at >= cutoff]

    return {
        "ref": _ref("taf", station.icao, "history"),
        "forecast_count": len(window),
        "earliest_issued_at": window[0].issued_at.isoformat(),
        "latest_issued_at": window[-1].issued_at.isoformat(),
        "amended_count": sum(1 for item in window if item.is_amended),
        "corrected_count": sum(1 for item in window if item.is_corrected),
        "issuances": [
            _taf_issuance(item) for item in window[-MAX_TAF_HISTORY_ISSUANCES:]
        ],
    }


def _taf_issuance(taf: Taf) -> dict[str, Any]:
    ceilings = [
        period.ceiling_ft
        for period in taf.periods
        if period.ceiling_ft is not None
    ]
    visibilities = [
        period.visibility_sm
        for period in taf.periods
        if period.visibility_sm is not None
    ]
    winds: list[int] = []
    weather: list[str] = []
    for period in taf.periods:
        if period.wind is not None:
            if period.wind.speed_kt is not None:
                winds.append(period.wind.speed_kt)
            if period.wind.gust_kt is not None:
                winds.append(period.wind.gust_kt)
        for code in period.weather:
            if code not in weather:
                weather.append(code)

    return {
        "issued_at": taf.issued_at.isoformat(),
        "valid_from": taf.valid_from.isoformat(),
        "valid_to": taf.valid_to.isoformat(),
        "is_amended": taf.is_amended,
        "is_corrected": taf.is_corrected,
        "period_count": len(taf.periods),
        "min_ceiling_ft": min(ceilings) if ceilings else None,
        "min_visibility_sm": min(visibilities) if visibilities else None,
        "max_wind_kt": max(winds) if winds else None,
        "weather": weather,
    }


def _area_summary(
    stations: Sequence[BriefStation],
) -> dict[str, Any] | None:
    """Distance-weighted area summary matching the Overview blend."""
    if len(stations) <= 1:
        return None

    readings = [
        (
            station,
            station.observation,
            1.0 / ((station.distance_nm or 0.0) + 1.0),
        )
        for station in stations
        if station.observation is not None
    ]
    if not readings:
        return None

    categories: dict[str, int] = {}
    temps: list[tuple[str, float, float]] = []
    dewpoints: list[tuple[str, float, float]] = []
    humidities: list[tuple[str, float, float]] = []
    visibilities: list[tuple[str, float, float]] = []
    ceilings: list[tuple[str, float, float]] = []

    for station, obs, weight in readings:
        cat = classify(obs).category
        if cat is not None:
            categories[cat] = categories.get(cat, 0) + 1
        if obs.temperature_c is not None:
            temps.append((station.icao, float(obs.temperature_c), weight))
        if obs.dewpoint_c is not None:
            dewpoints.append((station.icao, float(obs.dewpoint_c), weight))
        humidity = relative_humidity_pct(obs.temperature_c, obs.dewpoint_c)
        if humidity is not None:
            humidities.append((station.icao, float(humidity), weight))
        if (
            obs.visibility is not None
            and obs.visibility.statute_miles is not None
        ):
            visibilities.append(
                (station.icao, float(obs.visibility.statute_miles), weight)
            )
        if obs.ceiling_ft is not None:
            ceilings.append((station.icao, float(obs.ceiling_ft), weight))

    return {
        "ref": "area.summary",
        "station_count": len(stations),
        "reporting_count": len(readings),
        "category_counts": categories,
        "temperature_c": _weighted_temperature(temps),
        "dewpoint_c": _weighted_range(dewpoints, digits=1),
        "humidity_pct": _weighted_range(humidities, digits=0),
        "visibility_sm": _weighted_range(visibilities, digits=1),
        "ceiling_ft": _weighted_ceiling(ceilings),
        "wind": _weighted_wind(readings),
    }


def _weighted_avg(samples: list[tuple[str, float, float]]) -> float:
    total_w = sum(weight for _, _, weight in samples)
    return sum(value * weight for _, value, weight in samples) / total_w


def _weighted_temperature(
    samples: list[tuple[str, float, float]],
) -> dict[str, Any] | None:
    if not samples:
        return None
    low = min(samples, key=lambda item: item[1])
    high = max(samples, key=lambda item: item[1])
    return {
        "weighted_avg": round(_weighted_avg(samples), 1),
        "min": round(low[1], 1),
        "max": round(high[1], 1),
        "min_station": low[0],
        "max_station": high[0],
    }


def _weighted_range(
    samples: list[tuple[str, float, float]], *, digits: int
) -> dict[str, Any] | None:
    if not samples:
        return None
    avg = _weighted_avg(samples)
    low = min(value for _, value, _ in samples)
    high = max(value for _, value, _ in samples)
    if digits == 0:
        return {
            "weighted_avg": round(avg),
            "min": round(low),
            "max": round(high),
        }
    return {
        "weighted_avg": round(avg, digits),
        "min": round(low, digits),
        "max": round(high, digits),
    }


def _weighted_ceiling(
    samples: list[tuple[str, float, float]],
) -> dict[str, Any] | None:
    if not samples:
        return None
    return {
        "weighted_avg": int(round(_weighted_avg(samples) / 100.0) * 100),
        "min": int(min(value for _, value, _ in samples)),
        "max": int(max(value for _, value, _ in samples)),
        "reporting_count": len(samples),
    }


def _weighted_wind(
    readings: list[tuple[BriefStation, Observation, float]],
) -> dict[str, Any] | None:
    east = 0.0
    north = 0.0
    gust_sum = 0.0
    weight_sum = 0.0
    gust_weight = 0.0
    speeds: list[int] = []
    gusts: list[int] = []

    for _, obs, weight in readings:
        wind = obs.wind
        if wind is None or wind.speed_kt is None:
            continue
        speeds.append(wind.speed_kt)
        if wind.gust_kt is not None:
            gusts.append(wind.gust_kt)
        if wind.direction_deg is None or wind.is_variable:
            continue
        radians = math.radians(wind.direction_deg)
        east -= math.sin(radians) * wind.speed_kt * weight
        north -= math.cos(radians) * wind.speed_kt * weight
        weight_sum += weight
        if wind.gust_kt is not None:
            gust_sum += wind.gust_kt * weight
            gust_weight += weight

    if not speeds:
        return None

    direction_deg = None
    speed_kt = None
    if weight_sum > 0:
        speed = math.hypot(east, north) / weight_sum
        raw_dir = (math.degrees(math.atan2(-east, -north)) + 360.0) % 360.0
        direction_deg = (round(raw_dir / 10.0) * 10) % 360
        speed_kt = round(speed)

    return {
        "direction_deg": direction_deg,
        "speed_kt": speed_kt,
        "gust_kt": None if gust_weight == 0 else round(gust_sum / gust_weight),
        "max_speed_kt": max(speeds),
        "max_gust_kt": max(gusts) if gusts else None,
    }


def _ref(*parts: str) -> str:
    return ".".join(parts)


_WALL_CLOCK_METAR_KEYS = frozenset({"age_seconds", "age_minutes"})


def _hash(bundle: dict[str, Any]) -> str:
    """Hash only the weather facts, excluding wall-clock fields."""
    stable = {
        "definition_version": bundle["definition_version"],
        "definitions": bundle["definitions"],
        "area_summary": bundle["area_summary"],
        "stations": [
            {
                **station,
                "metar": None
                if station["metar"] is None
                else {
                    key: value
                    for key, value in station["metar"].items()
                    if key not in _WALL_CLOCK_METAR_KEYS
                },
            }
            for station in bundle["stations"]
        ],
    }
    canonical = json.dumps(
        stable, sort_keys=True, separators=(",", ":"), default=str
    )
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()
