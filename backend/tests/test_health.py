import httpx

from app.api import health as health_module
from app.main import app


async def _get_health() -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get("/api/health")


def _fake_providers(monkeypatch, database_ok: bool) -> None:
    async def fake_ping() -> tuple[bool, str | None]:
        return (True, None) if database_ok else (False, "OSError")

    async def fake_statuses(_settings) -> list[dict[str, object]]:
        return [
            {
                "name": "zai",
                "model": "glm-4.7-flash",
                "kind": "remote",
                "configured": True,
                "reachable": None,
            },
            {
                "name": "mlx",
                "model": "mlx-community/gemma-4-e2b-it-4bit",
                "kind": "local",
                "configured": True,
                "reachable": False,
            },
        ]

    monkeypatch.setattr(health_module, "ping", fake_ping)
    monkeypatch.setattr(health_module, "provider_statuses", fake_statuses)


async def test_health_reports_ok_when_database_reachable(monkeypatch) -> None:
    _fake_providers(monkeypatch, database_ok=True)

    response = await _get_health()

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] == {"ok": True, "error": None}
    assert "zai" in body["llm"]["chain"]
    assert [provider["name"] for provider in body["llm"]["providers"]] == ["zai", "mlx"]
    assert body["llm"]["providers"][1]["reachable"] is False


async def test_health_reports_degraded_when_database_unreachable(monkeypatch) -> None:
    _fake_providers(monkeypatch, database_ok=False)

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
