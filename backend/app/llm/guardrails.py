"""Deterministic refusals and verdict detection.

These rules never call a model. A verdict request gets fixed copy before
any provider is involved, because the cost of a wrong answer here is not
an awkward reply.
"""

from __future__ import annotations

import re

from app.llm.contract import RefusalKind

REFUSAL_COPY: dict[RefusalKind, str] = {
    "decision": (
        "I can't make go/no-go, safe-to-fly, or aircraft-performance "
        "calls. I can explain the observed and forecast facts, and an "
        "official briefing is still required."
    ),
    "out_of_scope": (
        "I only explain the weather at the selected station. Ask me about "
        "its ceiling, visibility, wind, forecast, history, or nearby "
        "advisories."
    ),
    "not_in_bundle": (
        "That isn't in the data for this station. I can only use the "
        "observation, forecast, history and advisories shown here."
    ),
}

_QUESTION_PATTERNS = (
    r"\bsafe to fly\b",
    r"\bgo[\s/-]*no[\s/-]*go\b",
    r"\bis (?:it|this) safe\b",
    r"\bshould (?:i|we|you) (?:fly|go|depart|launch)\b",
    r"\bcan (?:i|we|you) fly\b",
    r"\b(?:good|ok|okay|fine) "
    r"(?:day |weather |conditions? )?to fly\b",
    r"\bclear to depart\b",
    r"\brecommend (?:flying|the flight|departure)\b",
    r"\bwould you fly\b",
    r"\bam i (?:good|ok|okay) to (?:go|fly)\b",
    r"\bshould i file ifr\b",
)

_OUTPUT_PATTERNS = _QUESTION_PATTERNS + (
    r"\byou can fly\b",
    r"\byou should fly\b",
    r"\bno reason not to fly\b",
    r"\bconditions are safe\b",
)

_ASKS = tuple(
    re.compile(pattern, re.IGNORECASE) for pattern in _QUESTION_PATTERNS
)
_SAYS = tuple(
    re.compile(pattern, re.IGNORECASE) for pattern in _OUTPUT_PATTERNS
)


def asks_for_verdict(text: str) -> bool:
    return any(pattern.search(text) for pattern in _ASKS)


def contains_verdict(text: str) -> bool:
    return any(pattern.search(text) for pattern in _SAYS)


def fixed_refusal(kind: RefusalKind) -> str:
    return REFUSAL_COPY[kind]
