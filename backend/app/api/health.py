"""System endpoints: liveness, and ingest freshness later."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app import __version__
from app.config import get_settings
from app.db.session import ping
from app.llm.providers import statuses as provider_statuses

router = APIRouter(tags=["system"])


@router.get("/api/health")
@router.get("/health", include_in_schema=False)
async def health() -> JSONResponse:
    """503 when the database is unreachable, so a healthcheck fails loudly."""
    settings = get_settings()
    database_ok, database_error = await ping()

    payload = {
        "status": "ok" if database_ok else "degraded",
        "version": __version__,
        "env": settings.aerocast_env,
        "database": {"ok": database_ok, "error": database_error},
        "llm": {
            "chain": list(settings.llm_providers),
            "providers": await provider_statuses(settings),
        },
    }
    return JSONResponse(payload, status_code=200 if database_ok else 503)
