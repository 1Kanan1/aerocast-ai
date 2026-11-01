import pytest
from pydantic import ValidationError

from app.config import Settings


def make_settings(**overrides: object) -> Settings:
    """Build settings without reading the repo .env or the developer's environment."""
    return Settings(_env_file=None, **overrides)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("postgresql://u:p@localhost:5432/db", "postgresql+asyncpg://u:p@localhost:5432/db"),
        ("postgres://u:p@localhost:5432/db", "postgresql+asyncpg://u:p@localhost:5432/db"),
        ("postgresql+asyncpg://u:p@localhost/db", "postgresql+asyncpg://u:p@localhost/db"),
        ("  postgresql://u:p@localhost/db  ", "postgresql+asyncpg://u:p@localhost/db"),
    ],
)
def test_database_url_scheme_is_normalized(raw: str, expected: str) -> None:
    assert make_settings(database_url=raw).database_url == expected


def test_database_url_rejects_non_postgres() -> None:
    with pytest.raises(ValidationError, match="must be a PostgreSQL URL"):
        make_settings(database_url="mysql://localhost/db")


def test_empty_fallback_becomes_none() -> None:
    assert make_settings(llm_fallback="").llm_fallback is None
    assert make_settings(llm_fallback="gemini").llm_fallback == "gemini"


def test_provider_configuration_reflects_empty_keys() -> None:
    settings = make_settings(zai_api_key="", gemini_api_key="")
    assert settings.zai_configured is False
    assert settings.gemini_configured is False

    configured = make_settings(zai_api_key="secret", gemini_api_key="")
    assert configured.zai_configured is True
    assert configured.gemini_configured is False


def test_secrets_do_not_render_in_repr() -> None:
    settings = make_settings(zai_api_key="super-secret-key")
    assert "super-secret-key" not in repr(settings)
    assert "super-secret-key" not in str(settings.model_dump())
