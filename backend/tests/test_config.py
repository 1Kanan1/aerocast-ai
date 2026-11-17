from typing import Any

import pytest
from pydantic import ValidationError

from app.config import Settings


def make_settings(**overrides: Any) -> Settings:
    """Build settings without reading .env or the environment."""
    return Settings(_env_file=None, **overrides)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (
            "postgresql://u:p@localhost:5432/db",
            "postgresql+asyncpg://u:p@localhost:5432/db",
        ),
        (
            "postgresql+asyncpg://u:p@localhost/db",
            "postgresql+asyncpg://u:p@localhost/db",
        ),
        (
            "  postgresql://u:p@localhost/db  ",
            "postgresql+asyncpg://u:p@localhost/db",
        ),
    ],
)
def test_database_url_gets_the_async_driver(raw: str, expected: str) -> None:
    assert make_settings(database_url=raw).database_url == expected


@pytest.mark.parametrize(
    "url",
    [
        "mysql://localhost/db",
        # The pre-2009 alias. SQLAlchemy dropped it, so accepting it only
        # delays the failure to the first connection.
        "postgres://u:p@localhost/db",
        "sqlite+aiosqlite:///db.sqlite",
    ],
)
def test_database_url_rejects_anything_not_postgres(url: str) -> None:
    with pytest.raises(ValidationError, match="must be a PostgreSQL URL"):
        make_settings(database_url=url)


def test_each_provider_carries_its_own_transport() -> None:
    zai, gemini = make_settings(
        zai_models=" glm-a , glm-b,,glm-a ",
        gemini_models="gemini-a",
        gemini_reasoning_effort="medium",
    ).llm_providers

    assert zai.name == "zai"
    assert zai.models == ("glm-a", "glm-b")
    assert zai.base_url.startswith("https://api.z.ai/")
    assert zai.response_format == "json"
    assert zai.reasoning_effort is None

    assert gemini.name == "gemini"
    assert gemini.models == ("gemini-a",)
    assert gemini.base_url.startswith("https://generativelanguage")
    assert gemini.response_format == "schema"
    assert gemini.reasoning_effort == "medium"


def test_a_provider_is_configured_by_a_non_empty_key() -> None:
    zai, gemini = make_settings(
        zai_api_key="",
        gemini_api_key="secret",
    ).llm_providers

    assert zai.configured is False
    assert gemini.configured is True


def test_no_provider_uses_a_moving_model_alias() -> None:
    """`-latest` aliases drift without a commit. Pinned ids only."""
    models = [
        model
        for provider in make_settings().llm_providers
        for model in provider.models
    ]

    assert models
    for model in models:
        assert not model.endswith("-latest"), model
        assert "/" not in model, model


def test_secrets_do_not_render_in_repr() -> None:
    settings = make_settings(zai_api_key="super-secret-key")
    assert "super-secret-key" not in repr(settings)
    assert "super-secret-key" not in str(settings.model_dump())
    assert "super-secret-key" not in repr(settings.llm_providers)
