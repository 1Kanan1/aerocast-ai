"""Provider inventory. Every provider speaks OpenAI chat completions."""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass

from app.config import Settings, Target

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ProviderStatus:
    name: str
    model: str
    configured: bool

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def _resolve(settings: Settings, target: Target) -> list[ProviderStatus]:
    """One pool entry can expand to several rungs, e.g. a bare name."""
    match target.provider:
        case "orcarouter":
            return [
                ProviderStatus(
                    name="orcarouter",
                    model=model,
                    configured=settings.orca_configured,
                )
                for model in target.models(settings.orca_model_list)
            ]
        case "zai":
            return [
                ProviderStatus(
                    name="zai",
                    model=model,
                    configured=settings.zai_configured,
                )
                for model in target.models(settings.zai_model_list)
            ]
        case "gemini":
            return [
                ProviderStatus(
                    name="gemini",
                    model=model,
                    configured=settings.gemini_configured,
                )
                for model in target.models(settings.gemini_model_list)
            ]
    return []


async def statuses(settings: Settings) -> list[dict[str, object]]:
    """Chain order, de-duplicated on provider and model."""
    described: list[dict[str, object]] = []
    seen: set[tuple[str, str]] = set()

    for target in settings.llm_targets:
        resolved = _resolve(settings, target)
        if not resolved:
            logger.warning("pool entry has no models: %s", target)
            continue

        for status in resolved:
            key = (status.name, status.model)
            if key in seen:
                continue
            seen.add(key)
            described.append(status.as_dict())

    return described
