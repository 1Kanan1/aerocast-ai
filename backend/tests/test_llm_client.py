import json

import httpx
from pydantic import SecretStr

from app.config import Settings
from app.llm.client import complete, rungs


def settings(**overrides: object) -> Settings:
    defaults = Settings(
        database_url="postgresql://user:pass@localhost:5432/aerocast",
        zai_api_key=SecretStr("zai-key"),
        gemini_api_key=SecretStr("gemini-key"),
        llm_chain="zai,gemini",
    )
    return defaults.model_copy(update=overrides)


class FakeResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return self.payload


def answer_payload() -> dict[str, object]:
    content = json.dumps(
        {
            "summary": "KSFO is VFR.",
            "claims": [],
            "caveats": [],
            "refusal_kind": None,
        }
    )
    return {"choices": [{"message": {"content": content}}]}


def test_rungs_follow_the_chain_and_skip_unconfigured_providers():
    chain = rungs(
        settings(
            gemini_api_key=None,
            local_base_url="http://127.0.0.1:8080/v1",
            llm_chain="zai,gemini,local",
        )
    )

    assert [rung.name for rung in chain] == ["zai", "local"]
    assert chain[0].response_format == "json"
    assert chain[1].response_format == "none"


def test_gemini_expands_to_its_ladder():
    chain = rungs(
        settings(
            zai_api_key=None,
            gemini_models="gemini-a,gemini-b",
        )
    )

    assert [rung.model for rung in chain] == ["gemini-a", "gemini-b"]
    assert all(rung.name == "gemini" for rung in chain)


async def test_complete_falls_through_to_the_next_provider(monkeypatch):
    attempts: list[str] = []

    async def fake_post(
        client: httpx.AsyncClient,
        url: str,
        json: dict[str, object],
        headers: dict[str, str],
    ) -> FakeResponse:
        attempts.append(url)
        if "z.ai" in url:
            raise httpx.ConnectError("zai down")
        return FakeResponse(answer_payload())

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    completion = await complete(settings(), [], {})

    assert completion is not None
    assert completion.provider == "gemini"
    assert isinstance(completion.payload, dict)
    assert completion.payload["summary"] == "KSFO is VFR."
    assert len(attempts) == 2


async def test_complete_returns_none_when_every_rung_fails(monkeypatch):
    async def fake_post(*args: object, **kwargs: object) -> FakeResponse:
        raise httpx.ConnectError("down")

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    assert await complete(settings(), [], {}) is None


async def test_complete_accepts_a_fenced_json_answer(monkeypatch):
    content = (
        "```json\n"
        '{"summary": "KSFO is VFR.", "claims": [], '
        '"caveats": [], "refusal_kind": null}\n'
        "```"
    )

    async def fake_post(*args: object, **kwargs: object) -> FakeResponse:
        return FakeResponse({"choices": [{"message": {"content": content}}]})

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    completion = await complete(settings(), [], {})

    assert completion is not None
    assert isinstance(completion.payload, dict)
    assert completion.payload["summary"] == "KSFO is VFR."


async def test_complete_rejects_unusable_content(monkeypatch):
    async def fake_post(*args: object, **kwargs: object) -> FakeResponse:
        return FakeResponse(
            {"choices": [{"message": {"content": "not json"}}]}
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    assert await complete(settings(), [], {}) is None
