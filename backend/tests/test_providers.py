from typing import Any

from app.config import Settings
from app.llm.providers import reset_probe_cache, statuses


def make_settings(**overrides: Any) -> Settings:
    return Settings(_env_file=None, **overrides)


async def test_local_aliases_collapse_to_one_provider() -> None:
    reset_probe_cache()
    settings = make_settings(
        llm_chain="mlx,omlx,local",
        local_base_url="",
        zai_api_key="",
        gemini_api_key="",
    )

    described = await statuses(settings)

    assert [provider["name"] for provider in described] == ["local"]
    assert described[0]["kind"] == "local"
    assert described[0]["configured"] is False
    # No base URL means nothing to probe, so reachability stays unknown.
    assert described[0]["reachable"] is None


async def test_remote_providers_report_configured_without_being_probed() -> (
    None
):
    settings = make_settings(
        llm_chain="zai", zai_api_key="secret", local_base_url=""
    )

    described = await statuses(settings)

    assert described[0]["name"] == "zai"
    assert described[0]["configured"] is True
    assert described[0]["reachable"] is None


async def test_chain_order_is_preserved() -> None:
    settings = make_settings(
        llm_chain="local,zai,gemini",
        local_base_url="",
        zai_api_key="secret",
        gemini_api_key="secret",
    )

    described = await statuses(settings)

    assert [provider["name"] for provider in described] == [
        "local",
        "zai",
        "zai",
        "gemini",
        "gemini",
        "gemini",
    ]
    assert described[3]["model"] == "gemini-3.5-flash-lite"


async def test_zai_expands_into_its_model_ladder() -> None:
    settings = make_settings(
        llm_chain="zai",
        zai_api_key="secret",
        zai_models="glm-a, glm-b",
        local_base_url="",
    )

    described = await statuses(settings)

    assert [provider["model"] for provider in described] == [
        "glm-a",
        "glm-b",
    ]
    assert all(provider["name"] == "zai" for provider in described)


async def test_pool_pins_models_across_providers() -> None:
    settings = make_settings(
        llm_chain="gemini/gemini-b,zai/glm-a",
        gemini_api_key="secret",
        zai_api_key="secret",
        local_base_url="",
    )

    described = await statuses(settings)

    assert [
        (provider["name"], provider["model"]) for provider in described
    ] == [
        ("gemini", "gemini-b"),
        ("zai", "glm-a"),
    ]


async def test_gemini_expands_into_its_model_ladder() -> None:
    settings = make_settings(
        llm_chain="gemini",
        gemini_api_key="secret",
        gemini_models="gemini-3.6-flash, gemini-3.5-flash-lite",
        local_base_url="",
    )

    described = await statuses(settings)

    assert [provider["model"] for provider in described] == [
        "gemini-3.6-flash",
        "gemini-3.5-flash-lite",
    ]
    assert all(provider["name"] == "gemini" for provider in described)
    assert all(provider["configured"] is True for provider in described)


async def test_the_same_model_twice_appears_once() -> None:
    settings = make_settings(
        llm_chain="gemini,gemini",
        gemini_api_key="secret",
        gemini_models="gemini-3.6-flash",
        local_base_url="",
    )

    assert len(await statuses(settings)) == 1
