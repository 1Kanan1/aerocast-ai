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


@pytest.mark.parametrize(
    ("chain", "expected"),
    [
        ("zai,gemini,mlx", ("zai", "gemini", "mlx")),
        (" zai , omlx ", ("zai", "omlx")),
        ("mlx", ("mlx",)),
        ("zai,,gemini", ("zai", "gemini")),
    ],
)
def test_llm_chain_is_parsed_in_order(chain: str, expected: tuple[str, ...]) -> None:
    assert make_settings(llm_chain=chain).llm_providers == expected


def test_unknown_providers_are_dropped_from_the_chain() -> None:
    assert make_settings(llm_chain="zai,openai,gpt4all").llm_providers == ("zai",)


def test_provider_configuration_reflects_empty_keys() -> None:
    settings = make_settings(zai_api_key="", gemini_api_key="")
    assert settings.zai_configured is False
    assert settings.gemini_configured is False

    configured = make_settings(zai_api_key="secret", gemini_api_key="")
    assert configured.zai_configured is True
    assert configured.gemini_configured is False


def test_local_provider_configuration() -> None:
    assert make_settings(local_base_url="http://127.0.0.1:8080/v1").local_configured is True
    assert make_settings(local_base_url="").local_configured is False
    assert make_settings(local_base_url="").local_base_url is None


def test_no_provider_uses_a_moving_model_alias() -> None:
    """`-latest` aliases drift without a commit. Pinned ids only."""
    settings = make_settings()
    for model in (settings.zai_model, settings.gemini_model, settings.local_model):
        assert not model.endswith("-latest"), model
        assert model.count("/") <= 1, model


def test_secrets_do_not_render_in_repr() -> None:
    settings = make_settings(zai_api_key="super-secret-key")
    assert "super-secret-key" not in repr(settings)
    assert "super-secret-key" not in str(settings.model_dump())
