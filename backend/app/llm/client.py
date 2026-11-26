"""One OpenAI-compatible chat completion per rung, provider by provider."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Callable
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

#: Wait this long for the leading rung before hedging onto the next one.
HEDGE_DELAY_SECONDS = 1.5

#: Smoothing factor for per-rung EWMA latency (reacts within ~3 replies).
EWMA_ALPHA = 0.3

#: Prior latency for unmeasured rungs so fast rungs (<1.5 s) stay ahead of
#: them while slow rungs (>1.5 s) yield to unmeasured candidates.
EWMA_PRIOR_MS = HEDGE_DELAY_SECONDS * 1000.0

_cooldowns: dict[str, float] = {}
_ewma_ms: dict[str, float] = {}
_http: httpx.AsyncClient | None = None


def reset_cooldowns() -> None:
    _cooldowns.clear()
    _ewma_ms.clear()


def _record_latency(key: str, latency_ms: int) -> None:
    previous = _ewma_ms.get(key)
    sample = float(latency_ms)
    _ewma_ms[key] = (
        sample
        if previous is None
        else EWMA_ALPHA * sample + (1.0 - EWMA_ALPHA) * previous
    )


def _rank(eligible: list[tuple[Rung, str]]) -> list[tuple[Rung, str]]:
    """Order rungs by lowest EWMA latency, preserving config order on ties."""
    return sorted(
        eligible,
        key=lambda item: _ewma_ms.get(item[1], EWMA_PRIOR_MS),
    )


def _http_client() -> httpx.AsyncClient:
    """Shared client so provider calls reuse pooled TLS connections."""
    global _http
    if _http is None or _http.is_closed:
        _http = httpx.AsyncClient(timeout=RUNG_BUDGET_SECONDS)
    return _http


async def close_client() -> None:
    """Close the shared HTTP client on shutdown or between test loops."""
    global _http
    if _http is not None and not _http.is_closed:
        await _http.aclose()
    _http = None


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
    temperature: float | None = 0.2
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
    accept: Callable[[object], bool] | None = None,
    hedge_delay: float = HEDGE_DELAY_SECONDS,
) -> Completion | None:
    """Answer with the fastest valid rung using EWMA-ordered hedged requests.

    The leading rung (lowest EWMA latency) starts alone. If it answers within
    `hedge_delay`, no other provider is called. If it fails or returns a
    rejected draft, the next rung starts immediately; if it is still in flight
    after `hedge_delay`, the next rung launches alongside it and the first
    valid reply cancels the rest.

    `race=False` sends them one at a time, for a caller that wants one
    cheap opinion rather than hedged tail-latency protection.

    `namespace` separates cooldowns and EWMA stats, so a rung that timed out
    on the short scope check is still tried for the answer itself.

    `accept` lets the caller reject a draft inside the hedge loop so a fast,
    ungrounded reply does not cancel slower models that may still pass.
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

    if not race:
        return await _serial(eligible, messages, schema, budget, accept)
    return await _hedge(
        eligible, messages, schema, budget, accept, hedge_delay
    )


async def _serial(
    eligible: list[tuple[Rung, str]],
    messages: list[dict[str, str]],
    schema: dict[str, object],
    budget: float,
    accept: Callable[[object], bool] | None,
) -> Completion | None:
    deadline = time.monotonic() + budget
    for rung, key in _rank(eligible):
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
        if accept is not None and not accept(completion.payload):
            continue
        _record_latency(key, completion.latency_ms)
        return completion
    return None


async def _hedge(
    eligible: list[tuple[Rung, str]],
    messages: list[dict[str, str]],
    schema: dict[str, object],
    budget: float,
    accept: Callable[[object], bool] | None,
    hedge_delay: float,
) -> Completion | None:
    deadline = time.monotonic() + budget
    queue = iter(_rank(eligible))
    tasks: dict[asyncio.Task[Completion], tuple[Rung, str]] = {}

    def launch_next() -> bool:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        nxt = next(queue, None)
        if nxt is None:
            return False
        rung, key = nxt
        task = asyncio.ensure_future(
            _attempt(rung, messages, schema, remaining)
        )
        tasks[task] = (rung, key)
        return True

    try:
        if not launch_next():
            return None
        next_hedge = time.monotonic() + hedge_delay

        while tasks:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            wait_for = min(remaining, max(0.0, next_hedge - time.monotonic()))
            done, _ = await asyncio.wait(
                tasks,
                timeout=wait_for,
                return_when=asyncio.FIRST_COMPLETED,
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
                    result = task.result()
                    if accept is None or accept(result.payload):
                        winner = (result, key)

            if winner is not None:
                completion, key = winner
                _cooldowns.pop(key, None)
                _record_latency(key, completion.latency_ms)
                return completion

            if not tasks or time.monotonic() >= next_hedge:
                if launch_next():
                    next_hedge = time.monotonic() + hedge_delay
                else:
                    next_hedge = deadline
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

    response = await _http_client().post(
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
