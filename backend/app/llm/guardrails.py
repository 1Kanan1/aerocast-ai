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

AREA_REFUSAL_COPY: dict[RefusalKind, str] = {
    "decision": REFUSAL_COPY["decision"],
    "out_of_scope": (
        "I only explain the weather around this point on the map. Ask me "
        "about ceiling, visibility, wind, forecast, history, or nearby "
        "advisories from the stations here."
    ),
    "not_in_bundle": (
        "That isn't in the data for the stations around this point. I can "
        "only use the observations, forecasts, history and advisories "
        "shown here."
    ),
}

_QUESTION_PATTERNS = (
    r"\bsafe to (?:fly|depart|land|take[\s-]*off|go)\b",
    r"\bgo[\s/-]*no[\s/-]*go\b",
    r"\bis (?:it|this) (?:safe|legal|flyable)\b",
    r"\b(?:are (?:these|the) conditions? )?flyable\b",
    r"\bshould (?:i|we|you) "
    r"(?:fly|go|depart|launch|land|cancel|delay|postpone|scrub|divert|"
    r"file ifr)\b",
    r"\bcan (?:i|we|you|a [a-z]+ pilot|my [a-z0-9-]+) "
    r"(?:fly|depart|land|take[\s-]*off|make it)\b",
    r"\b(?:good|ok|okay|fine|suitable) "
    r"(?:day |weather |conditions? )?(?:to fly|for (?:vfr|ifr) flight)\b",
    r"\bclear to (?:depart|fly|land|take[\s-]*off)\b",
    r"\brecommend (?:flying|the flight|departure|cancelling|canceling|"
    r"delaying)\b",
    r"\bwould you (?:fly|depart|go|cancel|land)\b",
    r"\bam i (?:good|ok|okay|legal) to (?:go|fly|depart|land)\b",
    r"\btoo (?:windy|low|foggy|gusty|bad|dangerous|risky) to "
    r"(?:fly|depart|land|take[\s-]*off)\b",
)

_OUTPUT_PATTERNS = _QUESTION_PATTERNS + (
    r"\byou (?:can|should|should not|shouldn't|must not|cannot|can't) "
    r"(?:fly|depart|land|go)\b",
    r"\bdo not (?:fly|depart|land|take[\s-]*off)\b",
    r"\bno reason not to fly\b",
    r"\bconditions are (?:safe|unsafe|flyable|unflyable|"
    r"suitable for flight)\b",
    r"\b(?:safe|unsafe) for (?:vfr|ifr|flight|flying)\b",
    r"\bi recommend (?:flying|departing|cancelling|canceling|delaying|"
    r"diverting|not flying)\b",
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


def fixed_refusal(kind: RefusalKind, *, area: bool = False) -> str:
    return AREA_REFUSAL_COPY[kind] if area else REFUSAL_COPY[kind]
