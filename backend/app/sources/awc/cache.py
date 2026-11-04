"""Fetching and decoding AWC cache files."""

from __future__ import annotations

import gzip
from datetime import datetime

import httpx

USER_AGENT = "aerocast/0.1 (+https://github.com/)"


def download(url: str) -> bytes:
    response = httpx.get(
        url,
        headers={"User-Agent": USER_AGENT},
        timeout=60.0,
        follow_redirects=True,
    )
    response.raise_for_status()
    return response.content


def decompress(payload: bytes) -> str:
    if payload[:2] == b"\x1f\x8b":
        payload = gzip.decompress(payload)
    return payload.decode("utf-8", errors="replace")


def is_us(station: str) -> bool:
    """ICAO K and P prefixes cover the US and its territories."""
    return len(station) == 4 and station[0] in {"K", "P"}


def as_number(value: str | None) -> float | None:
    """AWC writes "10+" and "6+" for floors; float() drops those."""
    if value is None:
        return None
    cleaned = value.strip().lstrip("<>").rstrip("+")
    try:
        return float(cleaned)
    except ValueError:
        return None


def as_integer(value: str | None) -> int | None:
    number = as_number(value)
    return None if number is None else int(number)


def as_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
