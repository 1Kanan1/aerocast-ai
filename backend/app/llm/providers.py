"""Provider inventory. Every provider speaks OpenAI chat completions."""

from __future__ import annotations

import logging
import time
from dataclasses import asdict, dataclass, replace
from typing import Literal

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

PROBE_TTL_SECONDS = 10.0
PROBE_TIMEOUT_SECONDS = 0.5

_probe_cache: dict[str, tuple[float, bool]] = {}


@dataclass(frozen=True)
class ProviderStatus:
    name: str
    model: str
    kind: Literal["remote", "local"]
    configured: bool
    reachable: bool | None  # None: not probed

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def _resolve(settings: Settings, name: str) -> list[ProviderStatus]:
    """One chain entry can expand to several rungs, e.g. Gemini."""
    match name:
        case "zai":
            return [
                ProviderStatus(
                    name="zai",
                    model=settings.zai_model,
                    kind="remote",
                    configured=settings.zai_configured,
                    reachable=None,
                )
            ]
        case "gemini":
            return [
                ProviderStatus(
                    name="gemini",
                    model=model,
                    kind="remote",
                    configured=settings.gemini_configured,
                    reachable=None,
                )
                for model in settings.gemini_model_list
            ]
        case "local" | "mlx" | "omlx":
            return [
                ProviderStatus(
                    name="local",
                    model=settings.local_model,
                    kind="local",
                    configured=settings.local_configured,
                    reachable=None,
                )
            ]
    return []


async def _probe(base_url: str) -> bool:
    now = time.monotonic()
    cached = _probe_cache.get(base_url)
    if cached is not None and now - cached[0] < PROBE_TTL_SECONDS:
        return cached[1]

    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT_SECONDS) as client:
            response = await client.get(base_url.rstrip("/") + "/models")
        reachable = response.status_code < 500
    except Exception:  # noqa: BLE001 - an unreachable local server is expected
        reachable = False

    _probe_cache[base_url] = (now, reachable)
    return reachable


async def statuses(settings: Settings) -> list[dict[str, object]]:
    """Chain order, de-duplicated on provider and model."""
    described: list[dict[str, object]] = []
    seen: set[tuple[str, str]] = set()

    for name in settings.llm_providers:
        resolved = _resolve(settings, name)
        if not resolved:
            logger.warning("provider in LLM_CHAIN has no models: %s", name)
            continue

        for status in resolved:
            key = (status.name, status.model)
            if key in seen:
                continue
            seen.add(key)

            if (
                status.kind == "local"
                and status.configured
                and settings.local_base_url
            ):
                status = replace(
                    status, reachable=await _probe(settings.local_base_url)
                )

            described.append(status.as_dict())

    return described


def reset_probe_cache() -> None:
    _probe_cache.clear()
