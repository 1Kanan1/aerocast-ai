from typing import Any

import pytest
from pydantic import ValidationError

from app.config import Settings, Target


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


@pytest.mark.parametrize(
    ("chain", "expected"),
    [
        (" zai , gemini ", ("zai", "gemini")),
        (
            "gemini/gemini-3.5-flash-lite,zai/glm-4.5-flash",
            ("gemini/gemini-3.5-flash-lite", "zai/glm-4.5-flash"),
        ),
        (
            "orcarouter/deepseek/deepseek-v4.1-flash-free,zai",
            (
                "orcarouter/deepseek/deepseek-v4.1-flash-free",
                "zai",
            ),
        ),
        ("zai,,gemini", ("zai", "gemini")),
    ],
)
def test_pool_is_parsed_in_order(
    chain: str, expected: tuple[str, ...]
) -> None:
    targets = make_settings(llm_chain=chain).llm_targets
    assert (
        tuple(
            f"{target.provider}/{target.model}"
            if target.model
            else target.provider
            for target in targets
        )
        == expected
    )


def test_unknown_providers_are_dropped_from_the_pool() -> None:
    assert make_settings(llm_chain="zai,openai,gpt4all").llm_targets == (
        Target("zai", None),
    )


def test_a_vendor_prefix_without_its_router_names_nothing(caplog) -> None:
    """An Orca id looks like `vendor/model`; on its own it names no router."""
    settings = make_settings(llm_chain="deepseek/deepseek-v4.1-flash-free")

    assert settings.llm_targets == ()
    assert "names no known router" in caplog.text


def test_provider_configuration_reflects_empty_keys() -> None:
    settings = make_settings(
        zai_api_key="", gemini_api_key="", orca_api_key=""
    )
    assert settings.zai_configured is False
    assert settings.gemini_configured is False
    assert settings.orca_configured is False

    configured = make_settings(
        zai_api_key="secret", gemini_api_key="", orca_api_key="secret"
    )
    assert configured.zai_configured is True
    assert configured.gemini_configured is False
    assert configured.orca_configured is True


def test_no_provider_uses_a_moving_model_alias() -> None:
    """`-latest` aliases drift without a commit. Pinned ids only."""
    settings = make_settings()
    for model in (
        *settings.zai_model_list,
        *settings.gemini_model_list,
        *settings.orca_model_list,
        *(target.model for target in settings.llm_targets if target.model),
    ):
        assert not model.endswith("-latest"), model
        assert model.count("/") <= 1, model


def test_secrets_do_not_render_in_repr() -> None:
    settings = make_settings(zai_api_key="super-secret-key")
    assert "super-secret-key" not in repr(settings)
    assert "super-secret-key" not in str(settings.model_dump())
