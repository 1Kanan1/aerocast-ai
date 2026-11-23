"""Per-IP sliding-window rate limiting for LLM-backed endpoints."""

from __future__ import annotations

import math
import time
from collections import OrderedDict, deque

from fastapi import HTTPException, Request

#: Fifteen ask requests per minute per client IP protects provider quotas
#: without getting in the way of a person exploring stations on the map.
ASK_LIMIT = 15
ASK_WINDOW_SECONDS = 60.0
MAX_KEYS = 4096

_hits: OrderedDict[str, deque[float]] = OrderedDict()


def reset_rate_limits() -> None:
    _hits.clear()


def client_ip(request: Request) -> str:
    """Resolve the end-user IP behind Cloudflare, Traefik, and web proxy."""
    for header in ("cf-connecting-ip", "x-real-ip"):
        value = request.headers.get(header, "").strip()
        if value:
            return value

    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        first = forwarded.split(",", 1)[0].strip()
        if first:
            return first

    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def enforce_ask_limit(request: Request) -> None:
    """Raise 429 when an IP exceeds ASK_LIMIT within ASK_WINDOW_SECONDS."""
    now = time.monotonic()
    cutoff = now - ASK_WINDOW_SECONDS
    key = client_ip(request)

    timestamps = _hits.get(key)
    if timestamps is None:
        timestamps = deque()
        _hits[key] = timestamps
    else:
        _hits.move_to_end(key)

    while timestamps and timestamps[0] <= cutoff:
        timestamps.popleft()

    if len(timestamps) >= ASK_LIMIT:
        retry_after = max(
            1, math.ceil(ASK_WINDOW_SECONDS - (now - timestamps[0]))
        )
        raise HTTPException(
            status_code=429,
            detail="too many questions, try again shortly",
            headers={"Retry-After": str(retry_after)},
        )

    timestamps.append(now)
    while len(_hits) > MAX_KEYS:
        _hits.popitem(last=False)
