from typing import Any

import pytest
from pydantic import ValidationError

from app.config import Settings


def make_settings(**overrides: Any) -> Settings:
    """Build settings without reading .env or the environment.

    Every key is cleared explicitly: a developer with GEMINI_API_KEY or
    OPENAI_API_KEY exported would otherwise change what these assert.
    """
    keys: dict[str, Any] = {
        "gemini_api_key": None,
        "openai_api_key": None,
        "groq_api_key": None,
    }
    return Settings(_env_file=None, **{**keys, **overrides})


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
    gemini, openai, groq = make_settings(
        gemini_models=" gemini-a , gemini-b,,gemini-a ",
        gemini_reasoning_effort="medium",
        openai_models="luna-a",
        openai_reasoning_effort="none",
        groq_models="qwen/qwen3.8-27b",
        groq_reasoning_effort="low",
    ).llm_providers

    assert gemini.name == "gemini"
    assert gemini.models == ("gemini-a", "gemini-b")
    assert gemini.base_url.startswith("https://generativelanguage")
    assert gemini.response_format == "schema"
    assert gemini.reasoning_effort == "medium"

    assert openai.name == "openai"
    assert openai.models == ("luna-a",)
    assert openai.base_url == "https://api.openai.com/v1/"
    assert openai.response_format == "schema"
    assert openai.reasoning_effort == "none"

    assert groq.name == "groq"
    assert groq.models == ("qwen/qwen3.8-27b",)
    assert groq.base_url == "https://api.groq.com/openai/v1/"
    assert groq.response_format == "json"
    assert groq.reasoning_effort == "low"
    # Every other provider takes a pinned temperature; Luna rejects it.
    assert openai.temperature is None
    assert gemini.temperature == groq.temperature == 0.2


def test_a_provider_is_configured_by_a_non_empty_key() -> None:
    gemini, openai, groq = make_settings(
        gemini_api_key="secret",
        openai_api_key="",
    ).llm_providers

    assert gemini.configured is True
    assert openai.configured is False
    assert groq.configured is False


def test_no_provider_uses_a_moving_model_alias() -> None:
    """`-latest` aliases drift without a commit. Pinned ids only."""
    pairs = [
        (provider.name, model)
        for provider in make_settings().llm_providers
        for model in provider.models
    ]

    assert pairs
    for provider_name, model in pairs:
        assert not model.endswith("-latest"), model
        # Groq's canonical Qwen/Llama model ids include a vendor slash.
        if provider_name != "groq":
            assert "/" not in model, model


def test_secrets_do_not_render_in_repr() -> None:
    settings = make_settings(gemini_api_key="super-secret-key")
    assert "super-secret-key" not in repr(settings)
    assert "super-secret-key" not in str(settings.model_dump())
    assert "super-secret-key" not in repr(settings.llm_providers)
