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
from app.llm.scope import classify_scope
from app.llm.validate import InvalidAnswerError, validate_answer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["ask"])

ASK_BUDGET_SECONDS = 20.0


@router.post("/ask", response_model=models.Answer)
async def ask(request: models.AskRequest) -> dict[str, object]:
    question = request.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="question is empty")

    bundle, _ = await station_bundle(request.icao)

    if asks_for_verdict(question):
        return wire_answer(Answer("", (), (), fixed_refusal("decision")))

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

    completion = await complete(
        get_settings(),
        build_messages(bundle, question),
        ANSWER_SCHEMA,
        budget_seconds=ASK_BUDGET_SECONDS,
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
