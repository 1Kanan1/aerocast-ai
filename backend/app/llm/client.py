"""One OpenAI-compatible chat completion per rung, in LLM_CHAIN order."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

#: No single rung may hold an interactive request this long.
RUNG_BUDGET_SECONDS = 8.0

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
    api_key: str | None
    timeout: float
    response_format: Literal["schema", "json", "none"]
    reasoning_effort: str | None = None


def rungs(settings: Settings) -> list[Rung]:
    """The pool in `LLM_CHAIN` order. A bare provider expands in place."""
    found: list[Rung] = []

    for target in settings.llm_targets:
        match target.provider:
            case "orcarouter" if settings.orca_configured:
                for model in target.models(settings.orca_model_list):
                    found.append(
                        Rung(
                            name="orcarouter",
                            model=model,
                            base_url=settings.orca_base_url,
                            api_key=_secret(settings.orca_api_key),
                            timeout=settings.llm_timeout_seconds,
                            response_format="json",
                        )
                    )
            case "zai" if settings.zai_configured:
                for model in target.models(settings.zai_model_list):
                    found.append(
                        Rung(
                            name="zai",
                            model=model,
                            base_url=settings.zai_base_url,
                            api_key=_secret(settings.zai_api_key),
                            timeout=settings.llm_timeout_seconds,
                            response_format="json",
                        )
                    )
            case "gemini" if settings.gemini_configured:
                for model in target.models(settings.gemini_model_list):
                    found.append(
                        Rung(
                            name="gemini",
                            model=model,
                            base_url=settings.gemini_base_url,
                            api_key=_secret(settings.gemini_api_key),
                            timeout=settings.llm_thinking_timeout_seconds,
                            response_format="schema",
                            reasoning_effort=settings.gemini_reasoning_effort,
                        )
                    )
    return found


async def complete(
    settings: Settings,
    messages: list[dict[str, str]],
    schema: dict[str, object],
    budget_seconds: float | None = None,
) -> Completion | None:
    """Try each rung once. None means failure or an exhausted budget."""
    deadline = (
        None if budget_seconds is None else time.monotonic() + budget_seconds
    )

    for rung in rungs(settings):
        key = f"{rung.name}:{rung.model}"
        if _cooldowns.get(key, 0.0) > time.monotonic():
            logger.info("skipping %s during its cooldown", key)
            continue

        timeout = rung.timeout
        if deadline is not None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                logger.info("answer budget exhausted before %s", rung.name)
                break
            timeout = min(timeout, remaining, RUNG_BUDGET_SECONDS)

        started = time.monotonic()
        try:
            async with asyncio.timeout(timeout):
                payload = await _call(rung, messages, schema, timeout)
        except (
            TimeoutError,
            httpx.HTTPError,
            ValueError,
            KeyError,
            TypeError,
        ) as error:
            logger.warning(
                "provider %s (%s) failed: %s",
                rung.name,
                rung.model,
                error,
            )
            _cooldowns[key] = time.monotonic() + COOLDOWN_SECONDS
            continue

        _cooldowns.pop(key, None)
        return Completion(
            payload=payload,
            provider=rung.name,
            model=rung.model,
            latency_ms=int((time.monotonic() - started) * 1000),
        )

    return None


async def _call(
    rung: Rung,
    messages: list[dict[str, str]],
    schema: dict[str, object],
    timeout: float,
) -> object:
    body: dict[str, Any] = {
        "model": rung.model,
        "messages": messages,
        "temperature": 0,
    }
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
