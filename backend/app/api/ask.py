"""The explanation endpoint: brief, model, validation, fallback."""

from __future__ import annotations

import logging
import time
from dataclasses import replace

from fastapi import APIRouter, HTTPException, Request

from app.api import models
from app.api.ratelimit import enforce_ask_limit
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
from app.llm.prompts import build_messages
from app.llm.validate import InvalidAnswerError, validate_answer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["ask"])

#: The whole answer, not one rung: the reader waits once, not per model.
ASK_BUDGET_SECONDS = RUNG_BUDGET_SECONDS


@router.post("/ask", response_model=models.Answer)
async def ask(
    request: models.AskRequest, http_request: Request
) -> dict[str, object]:
    started = time.monotonic()
    question = request.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="question is empty")

    enforce_ask_limit(http_request)

    bundle, _ = await station_bundle(request.icao)

    if asks_for_verdict(question):
        return wire_answer(Answer("", (), (), fixed_refusal("decision")))

    return await explain(bundle, question, started=started)


async def explain(
    bundle: dict[str, object],
    question: str,
    *,
    area: bool = False,
    started: float | None = None,
) -> dict[str, object]:
    """Ask the model about a bundle, then validate or fall back.

    The caller has already refused verdicts. `started` is when the request
    arrived, so the answer can say how long the reader waited, failed rungs
    included.
    """
    began = time.monotonic() if started is None else started

    def accept(payload: object) -> bool:
        try:
            validate_answer(parse_model_answer(payload), bundle, area=area)
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
            area=area,
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
        if answer.refusal is None:
            answer = replace(
                answer,
                model=completion.model,
                elapsed_ms=int((time.monotonic() - began) * 1000),
            )

    return wire_answer(answer)
