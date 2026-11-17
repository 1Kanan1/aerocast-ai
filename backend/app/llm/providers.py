"""Provider inventory. Every provider speaks OpenAI chat completions."""

from __future__ import annotations

from dataclasses import asdict, dataclass

from app.config import Settings


@dataclass(frozen=True)
class ProviderStatus:
    name: str
    model: str
    configured: bool

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


async def statuses(settings: Settings) -> list[dict[str, object]]:
    """Every model that would be asked, provider by provider."""
    return [
        ProviderStatus(
            name=provider.name,
            model=model,
            configured=provider.configured,
        ).as_dict()
        for provider in settings.llm_providers
        for model in provider.models
    ]
