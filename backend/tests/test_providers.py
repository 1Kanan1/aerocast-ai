from typing import Any

from app.config import Settings
from app.llm.providers import statuses


def make_settings(**overrides: Any) -> Settings:
    return Settings(_env_file=None, **overrides)


async def test_remote_providers_report_configured_without_being_probed() -> (
    None
):
    settings = make_settings(llm_chain="zai", zai_api_key="secret")

    described = await statuses(settings)

    assert described[0]["name"] == "zai"
    assert described[0]["configured"] is True


async def test_chain_order_is_preserved() -> None:
    settings = make_settings(
        llm_chain="zai,gemini",
        zai_api_key="secret",
        gemini_api_key="secret",
    )

    described = await statuses(settings)

    assert [provider["name"] for provider in described] == [
        "zai",
        "zai",
        "gemini",
        "gemini",
        "gemini",
    ]
    assert described[2]["model"] == "gemini-3.5-flash-lite"


async def test_orcarouter_keeps_the_vendor_prefix_in_the_model_id() -> None:
    settings = make_settings(llm_chain="orcarouter", orca_api_key="secret")

    described = await statuses(settings)

    assert [provider["name"] for provider in described] == [
        "orcarouter",
        "orcarouter",
        "orcarouter",
    ]
    assert described[0]["model"] == "deepseek/deepseek-v4.1-flash-free"
    assert all(provider["configured"] is True for provider in described)


async def test_zai_expands_into_its_model_ladder() -> None:
    settings = make_settings(
        llm_chain="zai",
        zai_api_key="secret",
        zai_models="glm-a, glm-b",
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
    )

    assert len(await statuses(settings)) == 1
