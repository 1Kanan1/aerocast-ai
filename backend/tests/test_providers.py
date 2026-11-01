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


async def test_remote_providers_report_configured_without_being_probed() -> None:
    settings = make_settings(llm_chain="zai", zai_api_key="secret", local_base_url="")

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

    assert [provider["name"] for provider in described] == ["local", "zai", "gemini"]
