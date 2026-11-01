"""Model provider inventory.

Every provider speaks the OpenAI chat completions shape, so the only differences are a
base URL, a model id, and whether it needs a key. Remote providers report as configured
when a key exists; the local provider is probed because "the server is not running" is
the normal state for a laptop endpoint and the UI should not pretend otherwise.
"""

from __future__ import annotations

import logging
import time
from dataclasses import asdict, dataclass, replace

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

PROBE_TTL_SECONDS = 10.0
PROBE_TIMEOUT_SECONDS = 0.5

#: base_url -> (monotonic timestamp, reachable)
_probe_cache: dict[str, tuple[float, bool]] = {}


@dataclass(frozen=True)
class ProviderStatus:
    name: str
    model: str
    kind: str  # "remote" | "local"
    configured: bool
    #: None means "not probed". Remote providers are not probed: a probe would spend
    #: quota to answer a question the key's presence already answers well enough.
    reachable: bool | None

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def _resolve(settings: Settings, name: str) -> ProviderStatus | None:
    match name:
        case "zai":
            return ProviderStatus(
                name="zai",
                model=settings.zai_model,
                kind="remote",
                configured=settings.zai_configured,
                reachable=None,
            )
        case "gemini":
            return ProviderStatus(
                name="gemini",
                model=settings.gemini_model,
                kind="remote",
                configured=settings.gemini_configured,
                reachable=None,
            )
        case "local" | "mlx" | "omlx":
            return ProviderStatus(
                name="local",
                model=settings.local_model,
                kind="local",
                configured=settings.local_configured,
                reachable=None,
            )
    return None


async def _probe(base_url: str) -> bool:
    now = time.monotonic()
    cached = _probe_cache.get(base_url)
    if cached is not None and now - cached[0] < PROBE_TTL_SECONDS:
        return cached[1]

    url = base_url.rstrip("/") + "/models"
    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT_SECONDS) as client:
            response = await client.get(url)
        reachable = response.status_code < 500
    except Exception:  # noqa: BLE001 - an unreachable local server is expected
        reachable = False

    _probe_cache[base_url] = (now, reachable)
    return reachable


async def statuses(settings: Settings) -> list[dict[str, object]]:
    """Describe each configured provider in chain order, de-duplicated."""
    described: list[dict[str, object]] = []
    seen: set[str] = set()

    for name in settings.llm_providers:
        status = _resolve(settings, name)
        if status is None:
            logger.warning("ignoring unknown provider in LLM_CHAIN: %s", name)
            continue
        if status.name in seen:
            continue
        seen.add(status.name)

        if status.kind == "local" and status.configured and settings.local_base_url:
            status = replace(status, reachable=await _probe(settings.local_base_url))

        described.append(status.as_dict())

    return described


def reset_probe_cache() -> None:
    _probe_cache.clear()
