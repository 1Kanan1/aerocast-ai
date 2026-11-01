"""Application settings.

Environment variables are read here and nowhere else. The API is the only process that
holds secrets; the web app gets API_BASE_URL and nothing more.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = REPO_ROOT / ".env"

#: Providers the chain understands. "mlx" and "omlx" are accepted as aliases for
#: "local" because those are the names people reach for when they set the box up.
KNOWN_PROVIDERS = frozenset({"zai", "gemini", "local", "mlx", "omlx"})


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    aerocast_env: str = "local"
    database_url: str = "postgresql+asyncpg://aerocast:aerocast@localhost:5432/aerocast"

    # Tried left to right. The local model is last by default because a 4 bit
    # 2B effective model follows the citation contract less reliably than the hosted
    # ones. Set LLM_CHAIN=local to run fully offline.
    llm_chain: str = "zai,gemini,local"
    llm_timeout_seconds: float = 20.0
    # Thinking-capable models need their own budget. Gemini 3 answers in about a minute
    # at its lowest supported effort, so a single 20s budget would fail over too early.
    llm_thinking_timeout_seconds: float = 120.0

    zai_api_key: SecretStr | None = None
    zai_base_url: str = "https://api.z.ai/api/paas/v4/"
    zai_model: str = "glm-4.7-flash"

    gemini_api_key: SecretStr | None = None
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai/"
    gemini_model: str = "gemini-3.8-flash"
    # Gemini 3 cannot disable thinking, and "minimal" is rejected for gemini-3.8-flash.
    # Measured on a two-field JSON task: low = 63.6s / 105 tokens, medium = 99.4s / 314.
    # gemini-3.5-flash-lite answered the same task in 1.3s, which is why the fallback
    # rung is worth revisiting before Phase 5.
    gemini_reasoning_effort: str = "low"

    # Any OpenAI-compatible server on the machine: oMLX, Ollama, LM Studio, llama.cpp.
    # oMLX documents port 8000, which is taken by this API, so 8080 is the default here.
    local_base_url: str | None = "http://127.0.0.1:8080/v1"
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
        """Name asyncpg in the scheme when it is missing.

        create_async_engine() does not infer an async driver from a bare
        postgresql:// URL: it resolves the sync default (psycopg) and fails on import.
        """
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
        names = tuple(part.strip().lower() for part in self.llm_chain.split(",") if part.strip())
        return tuple(name for name in names if name in KNOWN_PROVIDERS)

    @property
    def zai_configured(self) -> bool:
        return bool(self.zai_api_key and self.zai_api_key.get_secret_value())

    @property
    def gemini_configured(self) -> bool:
        return bool(self.gemini_api_key and self.gemini_api_key.get_secret_value())

    @property
    def local_configured(self) -> bool:
        return bool(self.local_base_url)


@lru_cache
def get_settings() -> Settings:
    return Settings()
