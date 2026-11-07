"""Validate a model answer against the fact bundle.

The rule that matters for scope is simple: an answer that is not a
refusal must contain at least one claim, and that claim must cite a ref
that exists. Off-topic small talk has nothing to cite, so it never
reaches the screen as an answer.
"""

from __future__ import annotations

import math
import re

from app.llm.contract import Answer, DraftClaim, ModelAnswer
from app.llm.guardrails import contains_verdict, fixed_refusal

MAX_SUMMARY = 700
MAX_CLAIMS = 6
MAX_CLAIM_TEXT = 300
MAX_CAVEATS = 3
MAX_CAVEAT = 200

_NUMBER = re.compile(r"-?\d+(?:,\d{3})*(?:\.\d+)?")


class InvalidAnswerError(ValueError):
    """The draft failed a rule. The caller shows the template instead."""


def validate_answer(model: ModelAnswer, bundle: object) -> Answer:
    kind = model.refusal_kind
    if kind is not None:
        if kind not in ("decision", "out_of_scope", "not_in_bundle"):
            raise InvalidAnswerError(f"unknown refusal kind: {kind}")
        if model.claims:
            raise InvalidAnswerError("refusal carries claims")
        return Answer("", (), (), fixed_refusal(kind))

    summary = model.summary.strip()
    if not summary:
        raise InvalidAnswerError("empty summary")
    if len(summary) > MAX_SUMMARY:
        raise InvalidAnswerError("summary too long")
    if contains_verdict(summary):
        raise InvalidAnswerError("verdict language in summary")

    if not 1 <= len(model.claims) <= MAX_CLAIMS:
        raise InvalidAnswerError("claim count out of range")
    if len(model.caveats) > MAX_CAVEATS:
        raise InvalidAnswerError("too many caveats")

    caveats: list[str] = []
    for caveat in model.caveats:
        text = caveat.strip()
        if not text:
            continue
        if len(text) > MAX_CAVEAT:
            raise InvalidAnswerError("caveat too long")
        if contains_verdict(text):
            raise InvalidAnswerError("verdict language in caveat")
        caveats.append(text)

    index = _ref_index(bundle)
    claims: list[DraftClaim] = []

    for claim in model.claims:
        text = claim.text.strip()
        if not text:
            raise InvalidAnswerError("empty claim")
        if len(text) > MAX_CLAIM_TEXT:
            raise InvalidAnswerError("claim too long")
        if contains_verdict(text):
            raise InvalidAnswerError("verdict language in claim")
        if not claim.refs:
            raise InvalidAnswerError("claim without refs")

        missing = [ref for ref in claim.refs if ref not in index]
        if missing:
            raise InvalidAnswerError(f"unknown ref: {missing[0]}")

        values = [index[ref] for ref in claim.refs]
        if not _numbers_grounded(text, values):
            raise InvalidAnswerError("number not in the cited facts")

        claims.append(DraftClaim(text, tuple(claim.refs)))

    return Answer(summary, tuple(claims), tuple(caveats), None)


def _ref_index(bundle: object) -> dict[str, object]:
    index: dict[str, object] = {}

    def walk(node: object) -> None:
        if isinstance(node, dict):
            ref = node.get("ref")
            if isinstance(ref, str):
                index[ref] = node
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(bundle)
    return index


def _numbers_grounded(text: str, values: list[object]) -> bool:
    wanted = _numbers(text)
    if not wanted:
        return True

    allowed = _all_numbers(values)
    return all(
        any(_close(number, value) for value in allowed) for number in wanted
    )


def _numbers(text: str) -> list[float]:
    return [
        float(match.group().replace(",", ""))
        for match in _NUMBER.finditer(text)
    ]


def _all_numbers(values: list[object]) -> list[float]:
    found: list[float] = []

    def walk(node: object) -> None:
        if isinstance(node, bool):
            return
        if isinstance(node, int | float):
            found.append(float(node))
        elif isinstance(node, str):
            found.extend(_numbers(node))
        elif isinstance(node, dict):
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    for value in values:
        walk(value)
    return found


def _close(left: float, right: float) -> bool:
    return math.isclose(left, right, rel_tol=1e-9, abs_tol=0.05)
