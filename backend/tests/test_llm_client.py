import asyncio
import json
import time

import httpx
import pytest
from pydantic import SecretStr

from app.config import Settings
from app.llm import client as client_module
from app.llm.client import close_client, complete, reset_cooldowns, rungs
from app.llm.scope import classify_scope


@pytest.fixture(autouse=True)
def clear_cooldowns():
    reset_cooldowns()
    yield
    reset_cooldowns()


def settings(**overrides: object) -> Settings:
    # The keys are pinned, not read: an exported OPENAI_API_KEY would
    # otherwise add a rung these tests do not expect.
    defaults = Settings(
        _env_file=None,
        database_url="postgresql://user:pass@localhost:5432/aerocast",
        zai_api_key=SecretStr("zai-key"),
        gemini_api_key=SecretStr("gemini-key"),
        openai_api_key=None,
        groq_api_key=None,
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


def test_rungs_walk_the_providers_and_skip_unconfigured_ones():
    chain = rungs(
        settings(
            gemini_api_key=None,
            zai_models="glm-a,glm-b",
        )
    )

    assert [rung.name for rung in chain] == ["zai", "zai"]
    assert [rung.model for rung in chain] == ["glm-a", "glm-b"]
    assert chain[0].response_format == "json"


def test_zai_lists_its_models():
    chain = rungs(
        settings(
            gemini_api_key=None,
            zai_models="zai-a,zai-b",
        )
    )

    assert [rung.model for rung in chain] == ["zai-a", "zai-b"]
    assert all(rung.name == "zai" for rung in chain)


def test_the_default_providers_are_zai_then_gemini_then_openai():
    chain = rungs(
        Settings(
            _env_file=None,
            zai_api_key=SecretStr("zai-key"),
            gemini_api_key=SecretStr("gemini-key"),
            openai_api_key=SecretStr("openai-key"),
            groq_api_key=SecretStr("groq-key"),
        )
    )

    assert [(rung.name, rung.model) for rung in chain] == [
        ("zai", "glm-4.5-flash"),
        ("zai", "glm-4.7-flash"),
        ("gemini", "gemini-3.5-flash-lite"),
        ("openai", "gpt-6-luna"),
        ("groq", "qwen/qwen3.8-27b"),
    ]


def test_gemini_lists_its_models():
    chain = rungs(
        settings(
            zai_api_key=None,
            gemini_models="gemini-a,gemini-b",
            gemini_reasoning_effort="medium",
        )
    )

    assert [rung.model for rung in chain] == ["gemini-a", "gemini-b"]
    assert all(rung.name == "gemini" for rung in chain)
    assert all(rung.response_format == "schema" for rung in chain)
    assert all(rung.reasoning_effort == "medium" for rung in chain)


def test_a_repeated_model_is_asked_once():
    chain = rungs(
        settings(
            gemini_api_key=None,
            zai_models="glm-a,glm-a,glm-b",
        )
    )

    assert [rung.model for rung in chain] == ["glm-a", "glm-b"]


async def test_a_dead_provider_does_not_stop_the_answer(monkeypatch):
    async def fake_post(
        client: httpx.AsyncClient,
        url: str,
        json: dict[str, object],
        headers: dict[str, str],
    ) -> FakeResponse:
        if "z.ai" in url:
            raise httpx.ConnectError("zai down")
        return FakeResponse(answer_payload())

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    completion = await complete(settings(), [], {})

    assert completion is not None
    assert completion.provider == "gemini"
    assert isinstance(completion.payload, dict)
    assert completion.payload["summary"] == "KSFO is VFR."


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


async def test_a_timeout_does_not_stop_the_answer(monkeypatch):
    async def fake_post(
        client: httpx.AsyncClient,
        url: str,
        json: dict[str, object],
        headers: dict[str, str],
    ) -> FakeResponse:
        if "z.ai" in url:
            raise TimeoutError
        return FakeResponse(answer_payload())

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    completion = await complete(settings(), [], {}, budget_seconds=5)

    assert completion is not None
    assert completion.provider == "gemini"


async def test_the_fastest_reply_wins_and_the_slow_one_is_cancelled(
    monkeypatch,
):
    cancelled: list[str] = []

    async def fake_call(rung, messages, schema, timeout):
        if rung.model == "slow-model":
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                cancelled.append(rung.model)
                raise
        return {"summary": f"{rung.model} answered"}

    monkeypatch.setattr(client_module, "_call", fake_call)
    chain = settings(
        gemini_api_key=None,
        zai_models="slow-model,fast-model",
    )

    started = time.monotonic()
    completion = await complete(chain, [], {}, budget_seconds=30)
    waited = time.monotonic() - started

    assert completion is not None
    assert completion.model == "fast-model"
    assert waited < 1
    assert cancelled == ["slow-model"]

    # A loser was cut short, not broken, so it is still offered next time.
    completion = await complete(chain, [], {}, budget_seconds=30)
    assert completion is not None
    assert cancelled == ["slow-model", "slow-model"]


async def test_race_false_tries_the_rungs_in_turn(monkeypatch):
    calls: list[tuple[str, object, object, float]] = []

    async def fake_call(rung, messages, schema, timeout):
        calls.append((rung.model, messages, schema, timeout))
        if rung.model == "first-model":
            raise TimeoutError
        return {"summary": "answered"}

    monkeypatch.setattr(client_module, "_call", fake_call)
    chain = settings(
        gemini_api_key=None,
        zai_models="first-model,second-model",
    )
    messages = [{"role": "user", "content": "hi"}]
    schema: dict[str, object] = {"type": "object"}

    completion = await complete(
        chain, messages, schema, budget_seconds=0.5, race=False
    )

    assert completion is not None
    assert completion.model == "second-model"
    assert [name for name, *_ in calls] == ["first-model", "second-model"]
    assert all(call[1] is messages and call[2] is schema for call in calls)
    assert all(0 < call[3] <= 0.5 for call in calls)

    # The rung that failed above is benched, not retried.
    await complete(chain, messages, schema, budget_seconds=0.5, race=False)
    assert [name for name, *_ in calls] == [
        "first-model",
        "second-model",
        "second-model",
    ]


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
    second = await complete(settings(), [], {})

    assert len([url for url in attempts if "z.ai" in url]) == 2
    # The cooled rungs must not block the provider behind them.
    assert second is not None
    assert second.provider == "gemini"


async def test_every_rung_that_failed_is_benched(monkeypatch):
    attempted: list[str] = []

    async def fake_call(rung, messages, schema, timeout):
        attempted.append(rung.model)
        # One yield, so every rung fails in the same batch.
        await asyncio.sleep(0)
        raise httpx.ConnectError("down")

    monkeypatch.setattr(client_module, "_call", fake_call)
    chain = settings(gemini_api_key=None, zai_models="one,two,three")

    assert await complete(chain, [], {}, budget_seconds=5) is None
    assert sorted(attempted) == ["one", "three", "two"]

    assert await complete(chain, [], {}, budget_seconds=5) is None
    assert sorted(attempted) == ["one", "three", "two"]


async def test_a_rung_that_ignores_its_timeout_still_ends(monkeypatch):
    async def stuck(rung, messages, schema, timeout):
        await asyncio.sleep(30)

    monkeypatch.setattr(client_module, "_call", stuck)
    chain = settings(gemini_api_key=None, zai_models="only-model")

    started = time.monotonic()
    assert await complete(chain, [], {}, budget_seconds=0.2) is None

    assert time.monotonic() - started < 3


async def test_the_rung_gets_what_it_was_given(monkeypatch):
    seen: list[tuple[object, object, float]] = []

    async def fake_call(rung, messages, schema, timeout):
        seen.append((messages, schema, timeout))
        await asyncio.sleep(0.02)
        return {"summary": "ok"}

    monkeypatch.setattr(client_module, "_call", fake_call)
    chain = settings(gemini_api_key=None, zai_models="only-model")
    messages = [{"role": "user", "content": "hi"}]
    schema: dict[str, object] = {"type": "object"}

    completion = await complete(chain, messages, schema, budget_seconds=5)

    assert completion is not None
    assert completion.provider == "zai"
    assert completion.model == "only-model"
    assert completion.payload == {"summary": "ok"}
    assert seen == [(messages, schema, 5)]
    assert 20 <= completion.latency_ms < 3000


async def test_the_scope_check_asks_one_model(monkeypatch):
    calls: list[str] = []

    async def fake_call(rung, messages, schema, timeout):
        calls.append(rung.model)
        return {"in_scope": True, "reason": "weather"}

    monkeypatch.setattr(client_module, "_call", fake_call)
    chain = settings(zai_api_key=None, gemini_models="first,second,third")

    assert await classify_scope(chain, "what is the wind?") is True
    assert calls == ["first"]


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


async def test_a_scope_timeout_does_not_bench_the_rung_for_the_answer(
    monkeypatch,
):
    attempted: list[str] = []

    async def fake_call(rung, messages, schema, timeout):
        attempted.append(rung.model)
        if len(attempted) == 1:
            raise TimeoutError
        return answer_payload()

    monkeypatch.setattr(client_module, "_call", fake_call)
    one_rung = settings(gemini_api_key=None, zai_models="only-model")

    assert await complete(one_rung, [], {}, 1, namespace="scope") is None

    completion = await complete(one_rung, [], {})

    assert completion is not None
    assert attempted == ["only-model", "only-model"]


async def test_each_rung_sends_its_key(monkeypatch):
    seen: list[dict[str, str]] = []

    async def fake_post(
        client: httpx.AsyncClient,
        url: str,
        json: dict[str, object],
        headers: dict[str, str],
    ) -> FakeResponse:
        seen.append(headers)
        return FakeResponse(answer_payload())

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    await complete(
        settings(gemini_api_key=None, zai_models="zai-only"), [], {}
    )
    await complete(
        settings(zai_api_key=None, gemini_models="gemini-only"), [], {}
    )

    assert [header.get("authorization") for header in seen] == [
        "Bearer zai-key",
        "Bearer gemini-key",
    ]


async def test_a_model_that_only_takes_its_default_temperature(monkeypatch):
    bodies: list[dict[str, object]] = []

    async def fake_post(
        client: httpx.AsyncClient,
        url: str,
        json: dict[str, object],
        headers: dict[str, str],
    ) -> FakeResponse:
        bodies.append(json)
        return FakeResponse(answer_payload())

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    await complete(
        settings(
            zai_api_key=None,
            gemini_api_key=None,
            openai_api_key=SecretStr("openai-key"),
        ),
        [],
        {},
    )
    await complete(
        settings(gemini_api_key=None, zai_models="zai-only"), [], {}
    )

    # Luna answers 400 to any temperature but its default, so the key is
    # left out rather than pinned to a number the model will refuse.
    assert len(bodies) == 2
    assert "temperature" not in bodies[0]
    assert bodies[1]["temperature"] == 0


async def test_a_rung_that_names_a_reasoning_effort_sends_it(monkeypatch):
    bodies: list[dict[str, object]] = []

    async def fake_post(
        client: httpx.AsyncClient,
        url: str,
        json: dict[str, object],
        headers: dict[str, str],
    ) -> FakeResponse:
        bodies.append(json)
        return FakeResponse(answer_payload())

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    await complete(
        settings(zai_api_key=None, gemini_models="gemini-only"), [], {}
    )

    assert bodies[0]["reasoning_effort"] == "low"


async def test_a_rung_posts_to_its_own_base_url(monkeypatch):
    urls: list[str] = []

    async def fake_post(
        client: httpx.AsyncClient,
        url: str,
        json: dict[str, object],
        headers: dict[str, str],
    ) -> FakeResponse:
        urls.append(url)
        return FakeResponse(answer_payload())

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    await complete(
        settings(gemini_api_key=None, zai_models="only-model"), [], {}
    )

    assert urls == ["https://api.z.ai/api/paas/v4/chat/completions"]


async def test_every_rung_receives_the_system_prompt(monkeypatch):
    bodies: list[dict[str, object]] = []

    async def fake_post(
        client: httpx.AsyncClient,
        url: str,
        json: dict[str, object],
        headers: dict[str, str],
    ) -> FakeResponse:
        bodies.append(json)
        return FakeResponse(answer_payload())

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    messages = [{"role": "system", "content": "our own rules"}]
    await complete(
        settings(gemini_api_key=None, zai_models="zai-only"), messages, {}
    )
    await complete(
        settings(zai_api_key=None, gemini_models="gemini-only"),
        messages,
        {},
    )

    assert len(bodies) == 2
    assert all(body["messages"] == messages for body in bodies)


async def test_race_skips_a_rejected_reply_and_takes_a_valid_slower_one(
    monkeypatch,
):
    async def fake_call(rung, messages, schema, timeout):
        if rung.model == "slow-valid":
            await asyncio.sleep(0.03)
            return {"ok": True}
        return {"ok": False}

    monkeypatch.setattr(client_module, "_call", fake_call)
    chain = settings(
        gemini_api_key=None,
        zai_models="fast-invalid,slow-valid",
    )

    completion = await complete(
        chain,
        [],
        {},
        budget_seconds=5,
        accept=lambda payload: (
            isinstance(payload, dict) and payload.get("ok") is True
        ),
    )

    assert completion is not None
    assert completion.model == "slow-valid"


async def test_serial_skips_a_rejected_reply_and_takes_the_next(monkeypatch):
    async def fake_call(rung, messages, schema, timeout):
        return {"ok": rung.model == "second-valid"}

    monkeypatch.setattr(client_module, "_call", fake_call)
    chain = settings(
        gemini_api_key=None,
        zai_models="first-invalid,second-valid",
    )

    completion = await complete(
        chain,
        [],
        {},
        budget_seconds=5,
        race=False,
        accept=lambda payload: (
            isinstance(payload, dict) and payload.get("ok") is True
        ),
    )

    assert completion is not None
    assert completion.model == "second-valid"


async def test_provider_calls_reuse_one_http_client(monkeypatch):
    seen: list[httpx.AsyncClient] = []

    async def fake_post(
        client: httpx.AsyncClient,
        url: str,
        json: dict[str, object],
        headers: dict[str, str],
    ) -> FakeResponse:
        seen.append(client)
        return FakeResponse(answer_payload())

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    await close_client()
    try:
        one = settings(gemini_api_key=None, zai_models="zai-only")
        await complete(one, [], {})
        await complete(one, [], {})
        assert len(seen) == 2
        assert seen[0] is seen[1]
    finally:
        await close_client()
    assert seen[0].is_closed is True
