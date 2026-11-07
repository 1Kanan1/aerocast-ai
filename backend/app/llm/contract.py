"""The answer contract shared by the prompt, validator and API."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

RefusalKind = Literal["decision", "out_of_scope", "not_in_bundle"]


@dataclass(frozen=True, slots=True)
class DraftClaim:
    text: str
    refs: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ModelAnswer:
    summary: str
    claims: tuple[DraftClaim, ...]
    caveats: tuple[str, ...]
    refusal_kind: RefusalKind | None


@dataclass(frozen=True, slots=True)
class Answer:
    summary: str
    claims: tuple[DraftClaim, ...]
    caveats: tuple[str, ...]
    refusal: str | None


ANSWER_SCHEMA: dict[str, object] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["summary", "claims", "caveats", "refusal_kind"],
    "properties": {
        "summary": {"type": "string"},
        "claims": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["text", "refs"],
                "properties": {
                    "text": {"type": "string"},
                    "refs": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 1,
                    },
                },
            },
        },
        "caveats": {"type": "array", "items": {"type": "string"}},
        "refusal_kind": {
            "type": ["string", "null"],
            "enum": ["decision", "out_of_scope", "not_in_bundle", None],
        },
    },
}


def wire_answer(model: Answer) -> dict[str, object]:
    """The shape the frontend and the API response model already use."""
    return {
        "summary": model.summary,
        "claims": [
            {"text": claim.text, "refs": list(claim.refs)}
            for claim in model.claims
        ],
        "caveats": list(model.caveats),
        "refusal": model.refusal,
    }


def parse_model_answer(payload: object) -> ModelAnswer:
    """Parse provider JSON. A bad shape is an invalid answer, not a crash."""
    if not isinstance(payload, dict):
        raise ValueError("answer is not an object")

    summary = payload.get("summary")
    claims = payload.get("claims")
    caveats = payload.get("caveats")
    refusal = payload.get("refusal_kind")

    if not isinstance(summary, str):
        raise ValueError("summary is not a string")
    if refusal is not None and not isinstance(refusal, str):
        raise ValueError("refusal_kind is not a string")
    if not isinstance(claims, list) or not isinstance(caveats, list):
        raise ValueError("claims or caveats is not a list")

    parsed_claims: list[DraftClaim] = []
    for item in claims:
        if not isinstance(item, dict):
            raise ValueError("claim is not an object")
        text = item.get("text")
        refs = item.get("refs")
        if not isinstance(text, str):
            raise ValueError("claim text is not a string")
        if not isinstance(refs, list) or not all(
            isinstance(ref, str) for ref in refs
        ):
            raise ValueError("claim refs are not strings")
        parsed_claims.append(DraftClaim(text, tuple(refs)))

    if not all(isinstance(caveat, str) for caveat in caveats):
        raise ValueError("caveat is not a string")

    return ModelAnswer(
        summary=summary,
        claims=tuple(parsed_claims),
        caveats=tuple(caveats),
        refusal_kind=refusal,
    )
