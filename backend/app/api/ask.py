"""The explanation endpoint: brief, model, validation, fallback."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.api import models
from app.api.stations import station_bundle
from app.config import get_settings
from app.llm.client import complete
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


@router.post("/ask", response_model=models.Answer)
async def ask(request: models.AskRequest) -> dict[str, object]:
    question = request.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="question is empty")

    bundle, _ = await station_bundle(request.icao)

    if asks_for_verdict(question):
        return wire_answer(Answer("", (), (), fixed_refusal("decision")))

    completion = await complete(
        get_settings(),
        build_messages(bundle, question),
        ANSWER_SCHEMA,
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

    return wire_answer(answer)
