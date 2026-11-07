"""One OpenAI-compatible chat completion per rung, in LLM_CHAIN order."""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)


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
    """Configured rungs in the order the chain names them."""
    found: list[Rung] = []

    for name in settings.llm_providers:
        if name == "zai" and settings.zai_configured:
            found.append(
                Rung(
                    name="zai",
                    model=settings.zai_model,
                    base_url=settings.zai_base_url,
                    api_key=_secret(settings.zai_api_key),
                    timeout=settings.llm_timeout_seconds,
                    response_format="json",
                )
            )
        elif name == "gemini" and settings.gemini_configured:
            for model in settings.gemini_model_list:
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
        elif name == "local" and settings.local_configured:
            found.append(
                Rung(
                    name="local",
                    model=settings.local_model,
                    base_url=settings.local_base_url or "",
                    api_key=None,
                    timeout=settings.llm_timeout_seconds,
                    response_format="none",
                )
            )

    return found


async def complete(
    settings: Settings,
    messages: list[dict[str, str]],
    schema: dict[str, object],
) -> Completion | None:
    """Try each rung once. None means every provider failed."""
    for rung in rungs(settings):
        started = time.monotonic()
        try:
            payload = await _call(rung, messages, schema)
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as error:
            logger.warning(
                "provider %s (%s) failed: %s",
                rung.name,
                rung.model,
                error,
            )
            continue

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

    async with httpx.AsyncClient(timeout=rung.timeout) as client:
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
