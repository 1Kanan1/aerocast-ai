"""Settings. The API is the only process that holds secrets."""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import NamedTuple

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = REPO_ROOT / ".env"

#: Every `LLM_CHAIN` entry starts with the API router it calls. A model id may
#: carry a vendor prefix of its own, so the router always comes first.
KNOWN_PROVIDERS = frozenset({"zai", "gemini", "orcarouter"})


class Target(NamedTuple):
    """One pool entry. A bare router expands to its whole ladder in place."""

    provider: str
    model: str | None

    def models(self, ladder: tuple[str, ...]) -> tuple[str, ...]:
        return (self.model,) if self.model else ladder


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    aerocast_env: str = "local"
    database_url: str = (
        "postgresql+asyncpg://aerocast:aerocast@localhost:5432/aerocast"
    )

    #: One ordered pool, fastest model first. `router/model` pins a single
    #: entry; a bare router name expands to its ladder in place.
    llm_chain: str = (
        "orcarouter/deepseek/deepseek-v4.1-flash-free,"
        "orcarouter/z-ai/glm-5.3-flash-free,"
        "orcarouter/deepseek/deepseek-v4-flash-free,"
        "gemini/gemini-3.5-flash-lite,gemini/gemini-3.6-flash,"
        "zai/glm-4.7-flash,zai/glm-4.5-flash,gemini/gemini-3.8-flash"
    )
    llm_timeout_seconds: float = 20.0
    llm_thinking_timeout_seconds: float = 120.0

    zai_api_key: SecretStr | None = None
    zai_base_url: str = "https://api.z.ai/api/paas/v4/"
    #: ZAI's ladder, used when the pool names `zai` without a model. Both are
    #: free; 4.5 covers 4.7 when it is overloaded.
    zai_models: str = "glm-4.7-flash,glm-4.5-flash"

    gemini_api_key: SecretStr | None = None
    gemini_base_url: str = (
        "https://generativelanguage.googleapis.com/v1beta/openai/"
    )
    #: Gemini's ladder, used when the pool names `gemini` without a model.
    gemini_models: str = (
        "gemini-3.5-flash-lite,gemini-3.6-flash,gemini-3.8-flash"
    )
    gemini_reasoning_effort: str = "low"

    orca_api_key: SecretStr | None = None
    orca_base_url: str = "https://api.orcarouter.ai/v1"
    #: OrcaRouter's ladder, used when the pool names `orcarouter` without a
    #: model. Ids keep the upstream vendor's prefix.
    orca_models: str = (
        "deepseek/deepseek-v4.1-flash-free,"
        "z-ai/glm-5.3-flash-free,"
        "deepseek/deepseek-v4-flash-free"
    )

    @field_validator("database_url")
    @classmethod
    def name_the_async_driver(cls, value: str) -> str:
        """create_async_engine() will not infer an async driver."""
        url = value.strip()
        if url.startswith("postgresql://"):
            url = "postgresql+asyncpg://" + url.removeprefix("postgresql://")
        if not url.startswith("postgresql+asyncpg://"):
            raise ValueError(
                "DATABASE_URL must be a PostgreSQL URL "
                "(postgresql:// or postgresql+asyncpg://)"
            )
        return url

    @property
    def llm_targets(self) -> tuple[Target, ...]:
        """`LLM_CHAIN` parsed into pool entries, in the order written."""
        targets: list[Target] = []
        for part in self.llm_chain.split(","):
            provider, _, model = part.strip().partition("/")
            provider = provider.strip().lower()
            if provider not in KNOWN_PROVIDERS:
                logger.warning(
                    "LLM_CHAIN entry %r names no known router; dropping it",
                    part.strip(),
                )
                continue
            targets.append(Target(provider, model.strip() or None))
        return tuple(targets)

    @property
    def gemini_model_list(self) -> tuple[str, ...]:
        return tuple(
            model.strip()
            for model in self.gemini_models.split(",")
            if model.strip()
        )

    @property
    def zai_model_list(self) -> tuple[str, ...]:
        return tuple(
            model.strip()
            for model in self.zai_models.split(",")
            if model.strip()
        )

    @property
    def orca_model_list(self) -> tuple[str, ...]:
        return tuple(
            model.strip()
            for model in self.orca_models.split(",")
            if model.strip()
        )

    @property
    def zai_configured(self) -> bool:
        return bool(self.zai_api_key and self.zai_api_key.get_secret_value())

    @property
    def gemini_configured(self) -> bool:
        return bool(
            self.gemini_api_key and self.gemini_api_key.get_secret_value()
        )

    @property
    def orca_configured(self) -> bool:
        return bool(self.orca_api_key and self.orca_api_key.get_secret_value())


@lru_cache
def get_settings() -> Settings:
    return Settings()
