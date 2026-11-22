import httpx

from app.api import health as health_module
from app.config import Settings
from app.main import app


async def _get_health() -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as client:
        return await client.get("/api/health")


def _fake_providers(monkeypatch, database_ok: bool) -> None:
    async def fake_ping() -> tuple[bool, str | None]:
        return (True, None) if database_ok else (False, "OSError")

    async def fake_statuses(_settings) -> list[dict[str, object]]:
        return [
            {
                "name": "gemini",
                "model": "gemini-3.5-flash-lite",
                "configured": True,
            },
            {
                "name": "openai",
                "model": "gpt-6-luna",
                "configured": False,
            },
            {
                "name": "groq",
                "model": "qwen/qwen3.8-27b",
                "configured": False,
            },
        ]

    # The chain comes from settings, so it is pinned here: a developer's
    # .env must not decide what this test asserts.
    settings = Settings(
        _env_file=None,
        gemini_models="gemini-3.5-flash-lite",
        openai_models="gpt-6-luna",
        groq_models="qwen/qwen3.8-27b",
    )

    monkeypatch.setattr(health_module, "get_settings", lambda: settings)
    monkeypatch.setattr(health_module, "ping", fake_ping)
    monkeypatch.setattr(health_module, "provider_statuses", fake_statuses)


async def test_health_reports_ok_when_database_reachable(monkeypatch) -> None:
    _fake_providers(monkeypatch, database_ok=True)

    response = await _get_health()

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] == {"ok": True, "error": None}
    assert body["llm"]["chain"] == [
        "gemini/gemini-3.5-flash-lite",
        "openai/gpt-6-luna",
        "groq/qwen/qwen3.8-27b",
    ]
    assert [provider["name"] for provider in body["llm"]["providers"]] == [
        "gemini",
        "openai",
        "groq",
    ]
    assert body["llm"]["providers"][1]["configured"] is False
    assert body["llm"]["providers"][2]["configured"] is False


async def test_health_reports_degraded_when_database_unreachable(
    monkeypatch,
) -> None:
    _fake_providers(monkeypatch, database_ok=False)

    response = await _get_health()

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "degraded"
    assert body["database"] == {"ok": False, "error": "OSError"}


async def test_health_is_also_served_at_the_bare_path(monkeypatch) -> None:
    """Probes commonly use /health; the API path stays the documented one."""
    _fake_providers(monkeypatch, database_ok=True)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as client:
        response = await client.get("/health")

    assert response.status_code == 200


async def test_openapi_schema_is_served() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as client:
        response = await client.get("/api/openapi.json")

    assert response.status_code == 200
    assert "/api/health" in response.json()["paths"]
