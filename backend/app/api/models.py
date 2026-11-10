"""Response models, so the OpenAPI schema is the frontend's contract.

These describe payloads the routers already build; they are not a second
place to assemble them. Instant timestamps are typed as datetimes so the
whole API serializes them one way, whatever the query layer returned.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class Meta(BaseModel):
    source: str
    fetched_at: datetime | None
    observed_at: datetime | None
    valid_to: datetime | None
    age_seconds: int | None
    stale: bool


class Envelope[DataT](BaseModel):
    data: DataT
    meta: Meta


class Station(BaseModel):
    icao: str
    name: str
    state: str | None
    lat: float
    lon: float
    elev_m: int | None


class Observation(BaseModel):
    station_icao: str
    obs_time: datetime
    report_time: datetime | None
    raw: str
    decoded: dict[str, Any]
    category: str | None
    upstream_category: str | None
    parse_status: str
    parser_version: str
    fetched_at: datetime


class Forecast(BaseModel):
    station_icao: str
    issue_time: datetime
    valid_from: datetime
    valid_to: datetime
    raw: str
    periods: list[dict[str, Any]]
    parser_version: str
    fetched_at: datetime


class HistoryPoint(BaseModel):
    obs_time: datetime
    report_time: datetime | None
    category: str | None
    raw: str
    decoded: dict[str, Any]
    parse_status: str
    fetched_at: datetime


class Advisory(BaseModel):
    kind: str
    source_id: str
    hazard: str
    severity: str | None
    base_ft: int | None
    top_ft: int | None
    due_to: str | None
    valid_from: datetime
    valid_to: datetime
    geom: dict[str, Any]


class NearbyAdvisory(Advisory):
    distance_nm: float


class StationDetail(BaseModel):
    station: Station
    metar: Observation | None
    taf: Forecast | None
    advisories: list[NearbyAdvisory]


class MapAdvisory(BaseModel):
    kind: str
    hazard: str
    source_id: str
    geometry: dict[str, Any]


class MapLayers(BaseModel):
    """Only what the map draws: advisory polygons."""

    advisories: list[MapAdvisory]


class Pirep(BaseModel):
    report_time: datetime
    station_icao: str | None
    lat: float
    lon: float
    altitude_ft: int | None
    kind: str | None
    turbulence: str | None
    icing: str | None
    clouds: str | None


class JobRun(BaseModel):
    job: str
    status: str
    rows_upserted: int
    started_at: datetime
    finished_at: datetime | None
    error: str | None


class MetaResponse(BaseModel):
    counts: dict[str, int]
    jobs: list[JobRun]
    sources: dict[str, str]


class DatabaseStatus(BaseModel):
    ok: bool
    error: str | None


class ProviderStatus(BaseModel):
    name: str
    model: str
    kind: Literal["remote", "local"]
    configured: bool
    reachable: bool | None


class LlmStatus(BaseModel):
    chain: list[str]
    providers: list[ProviderStatus]


class Health(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    env: str
    database: DatabaseStatus
    llm: LlmStatus


class BundleCategory(BaseModel):
    ref: str
    value: str | None
    basis: str


class BundleWind(BaseModel):
    ref: str
    direction_deg: int | None
    speed_kt: int | None
    gust_kt: int | None
    is_variable: bool
    is_calm: bool


class BundleVisibility(BaseModel):
    ref: str
    statute_miles: float | None
    is_greater_than: bool
    is_less_than: bool


class BundleCeiling(BaseModel):
    ref: str
    ft: int | None


class BundleTemperature(BaseModel):
    ref: str
    c: float | None
    dewpoint_c: float | None
    dewpoint_spread_c: float | None


class BundleCloud(BaseModel):
    cover: str
    base_ft: int | None
    cloud_type: str | None


class BundleMetar(BaseModel):
    ref: str
    raw: str
    observed_at: datetime
    age_seconds: int
    station: str
    is_automated: bool
    flight_category: BundleCategory
    wind: BundleWind | None
    visibility: BundleVisibility | None
    ceiling: BundleCeiling
    clouds: list[BundleCloud]
    weather: list[str]
    temperature: BundleTemperature | None
    altimeter_in_hg: float | None
    remarks: str | None


class BundlePeriodWind(BaseModel):
    direction_deg: int | None
    speed_kt: int | None
    gust_kt: int | None


class BundlePeriod(BaseModel):
    ref: str
    change: str
    starts_at: datetime = Field(alias="from")
    ends_at: datetime = Field(alias="to")
    is_temporary: bool
    probability: int | None
    wind: BundlePeriodWind | None
    visibility_sm: float | None
    ceiling_ft: int | None
    weather: list[str]
    clouds: list[BundleCloud]


class BundleTaf(BaseModel):
    ref: str
    issued_at: datetime
    valid_from: datetime
    valid_to: datetime
    is_amended: bool
    is_corrected: bool
    periods: list[BundlePeriod]


class BundleAdvisory(BaseModel):
    ref: str
    kind: str
    hazard: str
    valid_to: datetime
    distance_nm: float | None
    due_to: str | None


class BundleStation(BaseModel):
    icao: str
    name: str
    lat: float
    lon: float
    metar: BundleMetar | None
    taf: BundleTaf | None
    advisories: list[BundleAdvisory]


class Bundle(BaseModel):
    generated_at: datetime
    definition_version: str
    stations: list[BundleStation]
    definitions: dict[str, str]
    brief_hash: str


class StationList(Envelope[list[Station]]):
    """Concrete envelopes, named so the generated types read as endpoints."""


class StationDetailResponse(Envelope[StationDetail]): ...


class StationHistory(Envelope[list[HistoryPoint]]): ...


class StationBrief(Envelope[Bundle]): ...


class MapLayersResponse(Envelope[MapLayers]): ...


class AdvisoryList(Envelope[list[Advisory]]): ...


class PirepList(Envelope[list[Pirep]]): ...


class AskRequest(BaseModel):
    icao: str = Field(min_length=3, max_length=8)
    question: str = Field(min_length=1, max_length=400)


class ResolveStation(BaseModel):
    icao: str
    name: str
    state: str | None
    lat: float
    lon: float


class ResolveSuggestion(ResolveStation):
    distance_nm: float
    age_seconds: int


class ResolveResponse(BaseModel):
    """What a free-text question resolves to, or the stations it might mean."""

    station: ResolveStation | None
    candidates: list[ResolveStation]
    suggested: list[ResolveSuggestion]
    message: str | None


class AnswerClaim(BaseModel):
    text: str
    refs: list[str]


class Answer(BaseModel):
    summary: str
    claims: list[AnswerClaim]
    caveats: list[str]
    refusal: str | None
    notice: str | None
