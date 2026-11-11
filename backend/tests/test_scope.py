"""The scope check reads one boolean out of a provider reply."""

from __future__ import annotations

from app.config import get_settings
from app.llm import scope
from app.llm.client import Completion


def reply(payload: object) -> Completion:
    return Completion(
        payload=payload, provider="test", model="test", latency_ms=1
    )


async def test_reads_an_out_of_scope_flag(monkeypatch) -> None:
    async def fake(*args: object, **kwargs: object) -> Completion:
        return reply({"in_scope": False, "reason": "small talk"})

    monkeypatch.setattr(scope, "complete", fake)

    assert await scope.classify_scope(get_settings(), "who are you?") is False


async def test_no_provider_means_no_opinion(monkeypatch) -> None:
    async def fake(*args: object, **kwargs: object) -> None:
        return None

    monkeypatch.setattr(scope, "complete", fake)

    assert await scope.classify_scope(get_settings(), "is it VFR?") is None


async def test_a_malformed_reply_means_no_opinion(monkeypatch) -> None:
    async def fake(*args: object, **kwargs: object) -> Completion:
        return reply({"in_scope": "yes"})

    monkeypatch.setattr(scope, "complete", fake)

    assert await scope.classify_scope(get_settings(), "is it VFR?") is None
