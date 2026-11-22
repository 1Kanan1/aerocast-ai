from typing import Any

from app.config import Settings
from app.llm.providers import statuses


def make_settings(**overrides: Any) -> Settings:
    return Settings(_env_file=None, **overrides)


async def test_remote_providers_report_configured_without_being_probed() -> (
    None
):
    settings = make_settings(
        gemini_api_key="secret",
        gemini_models="gemini-a",
        openai_models="",
        groq_models="",
    )

    described = await statuses(settings)

    assert described == [
        {"name": "gemini", "model": "gemini-a", "configured": True},
    ]


async def test_provider_and_model_order_is_preserved() -> None:
    settings = make_settings(
        gemini_api_key="secret",
        gemini_models="gemini-a,gemini-b",
        openai_api_key="secret",
        openai_models="luna-a",
        groq_api_key="secret",
        groq_models="qwen/qwen3.8-27b",
    )

    described = await statuses(settings)

    assert [
        (provider["name"], provider["model"]) for provider in described
    ] == [
        ("gemini", "gemini-a"),
        ("gemini", "gemini-b"),
        ("openai", "luna-a"),
        ("groq", "qwen/qwen3.8-27b"),
    ]
    assert all(provider["configured"] is True for provider in described)


async def test_an_unconfigured_provider_still_lists_its_models() -> None:
    settings = make_settings(
        gemini_api_key="",
        gemini_models="gemini-a",
        openai_models="",
        groq_models="",
    )

    assert await statuses(settings) == [
        {"name": "gemini", "model": "gemini-a", "configured": False},
    ]


async def test_the_same_model_twice_appears_once() -> None:
    settings = make_settings(
        gemini_api_key="secret",
        gemini_models="gemini-a,gemini-a",
        openai_models="",
        groq_models="",
    )

    assert len(await statuses(settings)) == 1
