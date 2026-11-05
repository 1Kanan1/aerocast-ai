"""The envelope every response shares."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

METAR_STALE_SECONDS = 90 * 60
TAF_STALE_SECONDS = 18 * 60 * 60
ADVISORY_STALE_SECONDS = 0


def meta(
    *,
    source: str,
    fetched_at: datetime | None = None,
    observed_at: datetime | None = None,
    valid_to: datetime | None = None,
    max_age_seconds: int | None = None,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    age = None
    if observed_at is not None:
        age = max(0, int((now - observed_at).total_seconds()))
    return {
        "source": source,
        "fetched_at": _iso(fetched_at),
        "observed_at": _iso(observed_at),
        "valid_to": _iso(valid_to),
        "age_seconds": age,
        "stale": age is not None
        and max_age_seconds is not None
        and age > max_age_seconds,
    }


def wrap(data: Any, **meta_args: Any) -> dict[str, Any]:
    return {"data": data, "meta": meta(**meta_args)}


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None
