"""The weather around a point, taken from the stations near it.

A map click is a question about a place, not about one airport. This
module answers it with the reports that actually cover the point: the
nearest stations, each still speaking for itself.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.api import models
from app.api.ask import explain
from app.api.envelope import wrap
from app.api.stations import brief_station, nearby_stations
from app.config import get_settings
from app.domain.brief import BriefStation, build_brief
from app.llm.contract import Answer, wire_answer
from app.llm.guardrails import fixed_refusal
from app.llm.scope import classify_scope

router = APIRouter(prefix="/api", tags=["area"])

#: A click describes the stations within this radius.
AREA_NM = 15.0


@router.get("/area", response_model=models.AreaResponse)
async def area(
    lat: float = Query(ge=-90, le=90),
    lon: float = Query(ge=-180, le=180),
) -> dict[str, Any]:
    """The stations around a point, with the bundle they describe."""
    rows = await nearby_stations(lat, lon, AREA_NM)

    return wrap(
        {
            "lat": lat,
            "lon": lon,
            "radius_nm": AREA_NM,
            "stations": rows,
            "brief": await area_brief(rows) if rows else None,
        },
        source="aviationweather.gov",
    )


@router.post("/area/ask", response_model=models.Answer)
async def area_ask(request: models.AreaAskRequest) -> dict[str, object]:
    """Answer a question about a point from the stations around it."""
    question = request.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="question is empty")

    rows = await nearby_stations(request.lat, request.lon, AREA_NM)
    if not rows:
        raise HTTPException(
            status_code=404, detail="no station within range of that point"
        )

    if await classify_scope(get_settings(), question) is False:
        return wire_answer(Answer("", (), (), fixed_refusal("out_of_scope")))

    bundle = await area_brief(rows)
    return await explain(bundle, question, area=True)


async def area_brief(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """One bundle describing every station around the point."""
    stations: list[BriefStation] = []
    for row in rows:
        built, _ = await brief_station(row)
        stations.append(built)

    return build_brief(stations, datetime.now(UTC))
