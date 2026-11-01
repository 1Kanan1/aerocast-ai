import httpx

from app.api import health as health_module
from app.main import app


async def _get_health() -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get("/api/health")


async def test_health_reports_ok_when_database_reachable(monkeypatch) -> None:
    async def fake_ping() -> tuple[bool, str | None]:
        return True, None

    monkeypatch.setattr(health_module, "ping", fake_ping)

    response = await _get_health()

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] == {"ok": True, "error": None}
    assert set(body["llm"]) == {
        "primary",
        "fallback",
        "zai_configured",
        "gemini_configured",
    }


async def test_health_reports_degraded_when_database_unreachable(monkeypatch) -> None:
    async def fake_ping() -> tuple[bool, str | None]:
        return False, "OSError"

    monkeypatch.setattr(health_module, "ping", fake_ping)

    response = await _get_health()

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "degraded"
    assert body["database"] == {"ok": False, "error": "OSError"}


async def test_openapi_schema_is_served() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/openapi.json")

    assert response.status_code == 200
    assert "/api/health" in response.json()["paths"]
