"""System endpoints: liveness, and ingest freshness later."""

from __future__ import annotations

from fastapi import APIRouter, Response

from app import __version__
from app.api import models
from app.config import get_settings
from app.db.session import ping
from app.llm.providers import statuses as provider_statuses

router = APIRouter(tags=["system"])


@router.get("/api/health", response_model=models.Health)
@router.get("/health", include_in_schema=False)
async def health(response: Response) -> dict[str, object]:
    """503 when the database is unreachable, so a healthcheck fails loudly."""
    settings = get_settings()
    database_ok, database_error = await ping()
    response.status_code = 200 if database_ok else 503

    return {
        "status": "ok" if database_ok else "degraded",
        "version": __version__,
        "env": settings.aerocast_env,
        "database": {"ok": database_ok, "error": database_error},
        "llm": {
            "chain": list(settings.llm_providers),
            "providers": await provider_statuses(settings),
        },
    }
