"""Settings. The API is the only process that holds secrets."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal, NamedTuple

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = REPO_ROOT / ".env"


class Provider(NamedTuple):
    """One provider: the models it offers and how to call them."""

    name: str
    models: tuple[str, ...]
    base_url: str
    api_key: SecretStr | None
    response_format: Literal["schema", "json", "none"]
    reasoning_effort: str | None = None

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.api_key.get_secret_value())


def _models(raw: str) -> tuple[str, ...]:
    """A comma-separated model list: trimmed, blanks and repeats dropped."""
    models = [model.strip() for model in raw.split(",") if model.strip()]
    return tuple(dict.fromkeys(models))


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

    zai_api_key: SecretStr | None = None
    zai_base_url: str = "https://api.z.ai/api/paas/v4/"
    zai_models: str = "glm-4.5-flash,glm-4.7-flash"

    gemini_api_key: SecretStr | None = None
    gemini_base_url: str = (
        "https://generativelanguage.googleapis.com/v1beta/openai/"
    )
    gemini_models: str = (
        "gemini-3.6-flash,gemini-3.5-flash-lite,gemini-3.8-flash"
    )
    gemini_reasoning_effort: str = "low"

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
    def llm_providers(self) -> tuple[Provider, ...]:
        """Every provider, in the order a serial caller tries them."""
        return (
            Provider(
                name="zai",
                models=_models(self.zai_models),
                base_url=self.zai_base_url,
                api_key=self.zai_api_key,
                response_format="json",
            ),
            Provider(
                name="gemini",
                models=_models(self.gemini_models),
                base_url=self.gemini_base_url,
                api_key=self.gemini_api_key,
                response_format="schema",
                reasoning_effort=self.gemini_reasoning_effort,
            ),
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
