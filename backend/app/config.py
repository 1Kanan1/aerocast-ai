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

#: Providers the chain understands. "omlx" is accepted as an alias for "mlx" because
#: that is the name of the server most people run the model with.
KNOWN_PROVIDERS = frozenset({"zai", "gemini", "mlx", "omlx"})


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
    # ones. Set LLM_CHAIN=mlx to run fully offline.
    llm_chain: str = "zai,gemini,mlx"
    llm_timeout_seconds: float = 20.0

    zai_api_key: SecretStr | None = None
    zai_base_url: str = "https://api.z.ai/api/paas/v4/"
    zai_model: str = "glm-4.7-flash"

    gemini_api_key: SecretStr | None = None
    gemini_model: str = "gemini-flash-latest"

    mlx_base_url: str | None = "http://127.0.0.1:8080/v1"
    mlx_model: str = "mlx-community/gemma-4-e2b-it-4bit"

    @field_validator("mlx_base_url", mode="before")
    @classmethod
    def empty_base_url_is_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("database_url")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        """Accept postgres:// and postgresql:// and hand SQLAlchemy asyncpg.

        The async engine needs the driver named in the scheme, and a bare
        postgresql:// URL produces a confusing missing-driver failure.
        """
        url = value.strip()
        if url.startswith("postgres://"):
            url = "postgresql://" + url.removeprefix("postgres://")
        if url.startswith("postgresql://"):
            url = "postgresql+asyncpg://" + url.removeprefix("postgresql://")
        if not url.startswith("postgresql+asyncpg://"):
            raise ValueError(
                "DATABASE_URL must be a PostgreSQL URL "
                "(postgres://, postgresql://, or postgresql+asyncpg://)"
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
    def mlx_configured(self) -> bool:
        return bool(self.mlx_base_url)


@lru_cache
def get_settings() -> Settings:
    return Settings()
