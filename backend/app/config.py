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
    temperature: float | None = 0.2
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

    gemini_api_key: SecretStr | None = None
    gemini_models: str = "gemini-3.5-flash-lite,gemini-4-hydrogen"
    gemini_reasoning_effort: str = "low"

    openai_api_key: SecretStr | None = None
    openai_models: str = "gpt-6-luna"
    openai_reasoning_effort: str = "low"

    groq_api_key: SecretStr | None = None
    groq_models: str = "qwen/qwen3.8-27b,openai/gpt-oss-120b"
    groq_reasoning_effort: str = "low"

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
        """Every provider, in the order a serial caller tries them.

        Each endpoint is written here rather than read from the environment:
        the URL and the request shape it accepts are one decision, and putting
        a copy in settings lets the two drift apart.
        """
        return (
            Provider(
                name="gemini",
                models=_models(self.gemini_models),
                base_url=(
                    "https://generativelanguage.googleapis.com/v1beta/openai/"
                ),
                api_key=self.gemini_api_key,
                response_format="schema",
                reasoning_effort=self.gemini_reasoning_effort,
            ),
            Provider(
                name="openai",
                models=_models(self.openai_models),
                base_url="https://api.openai.com/v1/",
                api_key=self.openai_api_key,
                response_format="schema",
                # Luna rejects any temperature but its default.
                temperature=None,
                reasoning_effort=self.openai_reasoning_effort,
            ),
            Provider(
                name="groq",
                models=_models(self.groq_models),
                base_url="https://api.groq.com/openai/v1/",
                api_key=self.groq_api_key,
                response_format="json",
                reasoning_effort=self.groq_reasoning_effort,
            ),
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
