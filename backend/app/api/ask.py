"""The explanation endpoint: brief, model, validation, fallback."""

from __future__ import annotations

import hashlib
import logging
import time
from collections import OrderedDict
from dataclasses import replace

from fastapi import APIRouter, HTTPException

from app.api import models
from app.api.stations import station_bundle
from app.config import get_settings
from app.llm.client import RUNG_BUDGET_SECONDS, complete
from app.llm.contract import (
    ANSWER_SCHEMA,
    Answer,
    parse_model_answer,
    wire_answer,
)
from app.llm.fallback import fallback_answer
from app.llm.guardrails import asks_for_verdict, fixed_refusal
from app.llm.prompts import PROMPT_VERSION, build_messages
from app.llm.scope import classify_scope
from app.llm.validate import InvalidAnswerError, validate_answer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["ask"])

#: The whole answer, not one rung: the reader waits once, not per model.
ASK_BUDGET_SECONDS = RUNG_BUDGET_SECONDS

#: Validated answers stay warm for 15 minutes while the brief is unchanged.
CACHE_TTL_SECONDS = 15 * 60
CACHE_MAX_ENTRIES = 512

_cache: OrderedDict[str, tuple[float, Answer]] = OrderedDict()


def reset_cache() -> None:
    _cache.clear()


def _cache_key(bundle: dict[str, object], question: str, area: bool) -> str:
    normalized = " ".join(question.lower().split())
    brief_hash = bundle.get("brief_hash", "")
    raw = f"{brief_hash}\0{PROMPT_VERSION}\0{int(area)}\0{normalized}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _cached(key: str, now: float) -> Answer | None:
    entry = _cache.get(key)
    if entry is None:
        return None
    expires_at, answer = entry
    if now >= expires_at:
        _cache.pop(key, None)
        return None
    _cache.move_to_end(key)
    return answer


def _remember(key: str, answer: Answer, now: float) -> None:
    _cache[key] = (now + CACHE_TTL_SECONDS, answer)
    _cache.move_to_end(key)
    while len(_cache) > CACHE_MAX_ENTRIES:
        _cache.popitem(last=False)


def cached_answer(
    bundle: dict[str, object],
    question: str,
    *,
    area: bool = False,
    started: float,
) -> dict[str, object] | None:
    hit = _cached(_cache_key(bundle, question, area=area), time.monotonic())
    if hit is None:
        return None
    return wire_answer(
        replace(hit, elapsed_ms=int((time.monotonic() - started) * 1000))
    )


@router.post("/ask", response_model=models.Answer)
async def ask(request: models.AskRequest) -> dict[str, object]:
    started = time.monotonic()
    question = request.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="question is empty")

    bundle, _ = await station_bundle(request.icao)

    if asks_for_verdict(question):
        return wire_answer(Answer("", (), (), fixed_refusal("decision")))

    cached = cached_answer(bundle, question, area=False, started=started)
    if cached is not None:
        return cached

    # A question that names the station is about that station, whatever else
    # it says: "KSEA" alone is a request, not small talk.
    stations = bundle.get("stations") or []
    station = stations[0] if stations else None
    name = station.get("name") if isinstance(station, dict) else None
    names_station = station is not None and (
        request.icao.upper() in question.upper()
        or (isinstance(name, str) and name.lower() in question.lower())
    )

    if (
        not names_station
        and await classify_scope(get_settings(), question) is False
    ):
        return wire_answer(Answer("", (), (), fixed_refusal("out_of_scope")))

    return await explain(bundle, question, started=started)


async def explain(
    bundle: dict[str, object],
    question: str,
    *,
    area: bool = False,
    started: float | None = None,
) -> dict[str, object]:
    """Ask the model about a bundle, then validate or fall back.

    The caller has already refused verdicts and decided whether the scope
    check can be skipped. `started` is when the request arrived, so the
    answer can say how long the reader waited, failed rungs included.
    """
    began = time.monotonic() if started is None else started
    key = _cache_key(bundle, question, area=area)
    hit = _cached(key, time.monotonic())
    if hit is not None:
        return wire_answer(
            replace(hit, elapsed_ms=int((time.monotonic() - began) * 1000))
        )

    def accept(payload: object) -> bool:
        try:
            validate_answer(parse_model_answer(payload), bundle)
        except (ValueError, InvalidAnswerError) as error:
            logger.info("answer draft rejected during race: %s", error)
            return False
        return True

    completion = await complete(
        get_settings(),
        build_messages(bundle, question, area=area),
        ANSWER_SCHEMA,
        budget_seconds=ASK_BUDGET_SECONDS,
        accept=accept,
    )
    if completion is None:
        return wire_answer(fallback_answer(bundle))

    try:
        answer = validate_answer(
            parse_model_answer(completion.payload),
            bundle,
        )
    except (ValueError, InvalidAnswerError) as error:
        logger.info(
            "answer rejected by %s/%s: %s",
            completion.provider,
            completion.model,
            error,
        )
        answer = fallback_answer(bundle)
    else:
        # Only a model-written answer names its model: the fallback and a
        # refusal are AeroCast's own words, not a completion.
        answer = replace(
            answer,
            model=completion.model,
            elapsed_ms=int((time.monotonic() - began) * 1000),
        )
        _remember(key, answer, time.monotonic())

    return wire_answer(answer)
