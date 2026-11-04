"""Settings. The API is the only process that holds secrets."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = REPO_ROOT / ".env"

#: "mlx" and "omlx" are aliases for "local".
KNOWN_PROVIDERS = frozenset({"zai", "gemini", "local", "mlx", "omlx"})


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

    llm_chain: str = "zai,gemini"
    llm_timeout_seconds: float = 20.0
    llm_thinking_timeout_seconds: float = 120.0

    zai_api_key: SecretStr | None = None
    zai_base_url: str = "https://api.z.ai/api/paas/v4/"
    zai_model: str = "glm-4.7-flash"

    gemini_api_key: SecretStr | None = None
    gemini_base_url: str = (
        "https://generativelanguage.googleapis.com/v1beta/openai/"
    )
    #: Ladder, tried left to right. Quality first, then the two fast models.
    gemini_models: str = (
        "gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite"
    )
    gemini_reasoning_effort: str = "low"

    #: Set to any OpenAI-compatible server to enable the local rung.
    local_base_url: str | None = None
    local_model: str = "mlx-community/gemma-4-e2b-it-4bit"

    @field_validator("local_base_url", mode="before")
    @classmethod
    def empty_base_url_is_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

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
    def llm_providers(self) -> tuple[str, ...]:
        names = tuple(
            part.strip().lower()
            for part in self.llm_chain.split(",")
            if part.strip()
        )
        return tuple(name for name in names if name in KNOWN_PROVIDERS)

    @property
    def gemini_model_list(self) -> tuple[str, ...]:
        return tuple(
            model.strip()
            for model in self.gemini_models.split(",")
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
    def local_configured(self) -> bool:
        return bool(self.local_base_url)


@lru_cache
def get_settings() -> Settings:
    return Settings()
