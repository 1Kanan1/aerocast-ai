"""One OpenAI-compatible chat completion per rung, provider by provider."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

#: No single rung may hold an interactive request this long. It is also the
#: whole answer's budget: a model that needs longer than this cannot answer.
RUNG_BUDGET_SECONDS = 35.0

#: A rung that just timed out or returned 429 is skipped for a while.
COOLDOWN_SECONDS = 60.0

_cooldowns: dict[str, float] = {}


def reset_cooldowns() -> None:
    _cooldowns.clear()


@dataclass(frozen=True)
class Completion:
    payload: object
    provider: str
    model: str
    latency_ms: int


@dataclass(frozen=True)
class Rung:
    name: str
    model: str
    base_url: str
    #: Kept out of the repr: a failing assertion must not print a key.
    api_key: str | None = field(repr=False)
    response_format: Literal["schema", "json", "none"]
    temperature: float | None = 0.0
    reasoning_effort: str | None = None


def rungs(settings: Settings) -> list[Rung]:
    """Every model of every configured provider."""
    return [
        Rung(
            name=provider.name,
            model=model,
            base_url=provider.base_url,
            api_key=_secret(provider.api_key),
            response_format=provider.response_format,
            temperature=provider.temperature,
            reasoning_effort=provider.reasoning_effort,
        )
        for provider in settings.llm_providers
        if provider.configured
        for model in provider.models
    ]


#: What a provider can be expected to raise. Anything else is our bug and
#: travels up instead of benching a rung.
_FAILURES = (TimeoutError, httpx.HTTPError, ValueError, KeyError, TypeError)


async def complete(
    settings: Settings,
    messages: list[dict[str, str]],
    schema: dict[str, object],
    budget_seconds: float | None = None,
    *,
    namespace: str = "answer",
    race: bool = True,
) -> Completion | None:
    """Answer with the first rung that replies. None means no reply in budget.

    Racing is what keeps one bad model from owning the request: tried in
    turn, a rung that never answers spends the whole budget on itself and
    the reader gets the fallback while a usable answer sat one rung
    further down. Sent together, the wait is the fastest reply instead of
    the sum of the failures in front of it, and the losers are cancelled
    the moment a winner lands.

    `race=False` sends them one at a time, for a caller that wants one
    cheap opinion rather than the fastest of several.

    `namespace` separates the cooldowns, so a rung that timed out on the
    short scope check is still tried for the answer itself.
    """
    budget = RUNG_BUDGET_SECONDS if budget_seconds is None else budget_seconds
    if budget <= 0:
        logger.info("answer budget was already spent")
        return None

    eligible = []
    for rung in rungs(settings):
        key = f"{namespace}:{rung.name}:{rung.model}"
        if _cooldowns.get(key, 0.0) > time.monotonic():
            logger.info("skipping %s during its cooldown", key)
            continue
        eligible.append((rung, key))

    if not eligible:
        return None

    driver = _race if race else _serial
    return await driver(eligible, messages, schema, budget)


async def _serial(
    eligible: list[tuple[Rung, str]],
    messages: list[dict[str, str]],
    schema: dict[str, object],
    budget: float,
) -> Completion | None:
    deadline = time.monotonic() + budget
    for rung, key in eligible:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            logger.info("answer budget exhausted before %s", rung.name)
            break
        try:
            completion = await _attempt(rung, messages, schema, remaining)
        except _FAILURES as error:
            _failed(rung, key, error)
            continue
        _cooldowns.pop(key, None)
        return completion
    return None


async def _race(
    eligible: list[tuple[Rung, str]],
    messages: list[dict[str, str]],
    schema: dict[str, object],
    budget: float,
) -> Completion | None:
    tasks = {
        asyncio.ensure_future(_attempt(rung, messages, schema, budget)): (
            rung,
            key,
        )
        for rung, key in eligible
    }
    try:
        while tasks:
            done, _ = await asyncio.wait(
                tasks, return_when=asyncio.FIRST_COMPLETED
            )
            winner: tuple[Completion, str] | None = None
            for task in done:
                rung, key = tasks.pop(task)
                error = task.exception()
                if error is not None:
                    if not isinstance(error, _FAILURES):
                        raise error
                    _failed(rung, key, error)
                elif winner is None:
                    winner = (task.result(), key)
            if winner is not None:
                completion, key = winner
                _cooldowns.pop(key, None)
                return completion
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    return None


async def _attempt(
    rung: Rung,
    messages: list[dict[str, str]],
    schema: dict[str, object],
    timeout: float,
) -> Completion:
    started = time.monotonic()
    async with asyncio.timeout(timeout):
        payload = await _call(rung, messages, schema, timeout)
    return Completion(
        payload=payload,
        provider=rung.name,
        model=rung.model,
        latency_ms=int((time.monotonic() - started) * 1000),
    )


def _failed(rung: Rung, key: str, error: BaseException) -> None:
    logger.warning(
        "provider %s (%s) failed: %s",
        rung.name,
        rung.model,
        error,
    )
    _cooldowns[key] = time.monotonic() + COOLDOWN_SECONDS


async def _call(
    rung: Rung,
    messages: list[dict[str, str]],
    schema: dict[str, object],
    timeout: float,
) -> object:
    body: dict[str, Any] = {
        "model": rung.model,
        "messages": messages,
    }
    if rung.temperature is not None:
        body["temperature"] = rung.temperature
    if rung.response_format == "schema":
        body["response_format"] = {
            "type": "json_schema",
            "json_schema": {
                "name": "aerocast_answer",
                "strict": True,
                "schema": schema,
            },
        }
    elif rung.response_format == "json":
        body["response_format"] = {"type": "json_object"}
    if rung.reasoning_effort is not None:
        body["reasoning_effort"] = rung.reasoning_effort

    headers = (
        {"authorization": f"Bearer {rung.api_key}"} if rung.api_key else {}
    )

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            rung.base_url.rstrip("/") + "/chat/completions",
            json=body,
            headers=headers,
        )
    response.raise_for_status()

    data = response.json()
    content = data["choices"][0]["message"]["content"]
    if not isinstance(content, str):
        raise ValueError("completion content is not text")
    return _loads(content)


def _loads(content: str) -> object:
    text = content.strip()
    if text.startswith("```"):
        text = text.removeprefix("```")
        text = text.removeprefix("json").strip()
        text = text.removesuffix("```").strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end <= start:
            raise
        return json.loads(text[start : end + 1])


def _secret(value: object) -> str | None:
    getter = getattr(value, "get_secret_value", None)
    return getter() if callable(getter) else None
