import json

import httpx
import pytest
from pydantic import SecretStr

from app.config import Settings
from app.llm.client import complete, reset_cooldowns, rungs


@pytest.fixture(autouse=True)
def clear_cooldowns():
    reset_cooldowns()
    yield
    reset_cooldowns()


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
            zai_models="glm-a,glm-b",
        )
    )

    assert [rung.name for rung in chain] == ["zai", "zai", "local"]
    assert [rung.model for rung in chain[:2]] == ["glm-a", "glm-b"]
    assert chain[0].response_format == "json"
    assert chain[2].response_format == "none"


def test_zai_expands_to_its_ladder():
    chain = rungs(
        settings(
            gemini_api_key=None,
            zai_models="zai-a,zai-b",
        )
    )

    assert [rung.model for rung in chain] == ["zai-a", "zai-b"]
    assert all(rung.name == "zai" for rung in chain)


def test_gemini_expands_to_its_ladder():
    chain = rungs(
        settings(
            zai_api_key=None,
            gemini_models="gemini-a,gemini-b",
        )
    )

    assert [rung.model for rung in chain] == ["gemini-a", "gemini-b"]
    assert all(rung.name == "gemini" for rung in chain)


def test_pool_pins_models_and_interleaves_providers():
    chain = rungs(
        settings(
            local_base_url="",
            gemini_models="gemini-a,gemini-b",
            zai_models="zai-a,zai-b",
            llm_chain="gemini/gemini-b,zai,gemini",
        )
    )

    assert [(rung.name, rung.model) for rung in chain] == [
        ("gemini", "gemini-b"),
        ("zai", "zai-a"),
        ("zai", "zai-b"),
        ("gemini", "gemini-a"),
        ("gemini", "gemini-b"),
    ]


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
    assert len(attempts) == 3


async def test_complete_returns_none_when_every_rung_fails(monkeypatch):
    async def fake_post(*args: object, **kwargs: object) -> FakeResponse:
        raise httpx.ConnectError("down")

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    assert await complete(settings(), [], {}) is None


async def test_complete_stops_before_the_budget_runs_out(monkeypatch):
    async def fail(*args: object, **kwargs: object) -> FakeResponse:
        raise AssertionError("no provider should be called")

    monkeypatch.setattr(httpx.AsyncClient, "post", fail)

    assert await complete(settings(), [], {}, budget_seconds=0) is None


async def test_complete_falls_through_a_timeout(monkeypatch):
    attempts: list[str] = []

    async def fake_post(
        client: httpx.AsyncClient,
        url: str,
        json: dict[str, object],
        headers: dict[str, str],
    ) -> FakeResponse:
        attempts.append(url)
        if "z.ai" in url:
            raise TimeoutError
        return FakeResponse(answer_payload())

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    completion = await complete(settings(), [], {}, budget_seconds=5)

    assert completion is not None
    assert completion.provider == "gemini"
    assert len(attempts) == 3


async def test_a_failed_rung_is_skipped_during_its_cooldown(monkeypatch):
    attempts: list[str] = []

    async def fake_post(
        client: httpx.AsyncClient,
        url: str,
        json: dict[str, object],
        headers: dict[str, str],
    ) -> FakeResponse:
        attempts.append(url)
        if "z.ai" in url:
            raise httpx.ConnectError("down")
        return FakeResponse(answer_payload())

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    await complete(settings(), [], {})
    await complete(settings(), [], {})

    assert len([url for url in attempts if "z.ai" in url]) == 2


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
