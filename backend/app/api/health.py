"""System endpoints: liveness and, once the scheduler exists, ingest freshness."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app import __version__
from app.config import get_settings
from app.db.session import ping

router = APIRouter(tags=["system"])


@router.get("/api/health")
async def health() -> JSONResponse:
    """Report process, database, and explanation-service status.

    Returns 503 when the database is unreachable so a container healthcheck fails
    loudly instead of serving an app that cannot read anything.
    """
    settings = get_settings()
    database_ok, database_error = await ping()

    payload = {
        "status": "ok" if database_ok else "degraded",
        "version": __version__,
        "env": settings.aerocast_env,
        "database": {"ok": database_ok, "error": database_error},
        "llm": {
            "primary": settings.llm_primary,
            "fallback": settings.llm_fallback,
            "zai_configured": settings.zai_configured,
            "gemini_configured": settings.gemini_configured,
        },
    }
    return JSONResponse(payload, status_code=200 if database_ok else 503)
