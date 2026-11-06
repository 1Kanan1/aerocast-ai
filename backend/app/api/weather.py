"""Active advisories and recent pilot reports."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from app.api import models
from app.api.envelope import wrap
from app.db.session import fetch_all

router = APIRouter(prefix="/api", tags=["weather"])


@router.get(
    "/advisories", response_model=models.Envelope[list[models.Advisory]]
)
async def advisories(
    kind: str | None = Query(default=None),
    hazard: str | None = Query(default=None),
) -> dict[str, Any]:
    rows = await fetch_all(
        "select kind, source_id, hazard, severity, base_ft, top_ft, "
        "due_to, valid_from, valid_to, geom from advisories "
        "where valid_to > now() "
        "and (cast(:kind as text) is null or kind = cast(:kind as text)) "
        "and (cast(:hazard as text) is null "
        "or hazard = cast(:hazard as text)) "
        "order by hazard, source_id",
        {"kind": kind, "hazard": hazard},
    )
    return wrap(rows, source="gairmet and sigmet")


@router.get("/pireps", response_model=models.Envelope[list[models.Pirep]])
async def pireps(hours: int = Query(default=3, ge=1, le=24)) -> dict[str, Any]:
    rows = await fetch_all(
        "select report_time, station_icao, lat, lon, altitude_ft, "
        "kind, turbulence, icing, clouds from pireps "
        "where report_time > "
        "now() - make_interval(hours => :hours) "
        "order by report_time desc",
        {"hours": hours},
    )
    return wrap(rows, source="awc pirep")
