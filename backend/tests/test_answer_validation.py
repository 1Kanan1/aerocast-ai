from datetime import UTC, datetime

import pytest

from app.domain.brief import BriefStation, build_brief
from app.domain.metar import parse_metar
from app.llm.contract import (
    DraftClaim,
    ModelAnswer,
    parse_model_answer,
)
from app.llm.validate import InvalidAnswerError, validate_answer

BUNDLE = {
    "stations": [
        {
            "icao": "KSFO",
            "metar": {
                "ref": "metar.KSFO",
                "flight_category": {
                    "ref": "metar.KSFO.flight_category",
                    "value": "VFR",
                },
                "visibility": {
                    "ref": "metar.KSFO.visibility",
                    "statute_miles": 10,
                },
                "ceiling": {"ref": "metar.KSFO.ceiling", "ft": 4300},
                "wind": {
                    "ref": "metar.KSFO.wind",
                    "direction_deg": 170,
                    "speed_kt": 11,
                },
            },
        }
    ],
    "brief_hash": "sha256:test",
}


def answer(summary, claims, caveats=(), refusal=None):
    return ModelAnswer(summary, tuple(claims), tuple(caveats), refusal)


def claim(text, *refs):
    return DraftClaim(text, refs)


def test_valid_answer_passes():
    result = validate_answer(
        answer(
            "KSFO is VFR.",
            [claim("The ceiling is 4,300 ft.", "metar.KSFO.ceiling")],
        ),
        BUNDLE,
    )

    assert result.summary == "KSFO is VFR."
    assert result.claims[0].refs == ("metar.KSFO.ceiling",)
    assert result.refusal is None


def test_unknown_ref_is_rejected():
    with pytest.raises(InvalidAnswerError, match="unknown ref"):
        validate_answer(
            answer(
                "KSFO is VFR.",
                [claim("The ceiling is 4,300 ft.", "metar.KSFO.nope")],
            ),
            BUNDLE,
        )


def test_invented_number_is_rejected():
    with pytest.raises(InvalidAnswerError, match="number not in"):
        validate_answer(
            answer(
                "KSFO is VFR.",
                [claim("The ceiling is 12,000 ft.", "metar.KSFO.ceiling")],
            ),
            BUNDLE,
        )


def test_number_from_another_fact_is_rejected():
    with pytest.raises(InvalidAnswerError, match="number not in"):
        validate_answer(
            answer(
                "KSFO is VFR.",
                [claim("Visibility is 10 SM.", "metar.KSFO.ceiling")],
            ),
            BUNDLE,
        )


def test_answer_without_claims_is_rejected():
    with pytest.raises(InvalidAnswerError, match="claim count"):
        validate_answer(answer("I'm doing well, thanks.", []), BUNDLE)


def test_refusal_gets_fixed_copy_and_drops_model_text():
    result = validate_answer(
        answer("I'm fine, how are you?", [], refusal="out_of_scope"),
        BUNDLE,
    )

    assert result.summary == ""
    assert result.claims == ()
    assert result.refusal is not None
    assert "selected station" in result.refusal


def test_refusal_with_claims_is_rejected():
    with pytest.raises(InvalidAnswerError, match="refusal carries claims"):
        validate_answer(
            answer(
                "",
                [claim("The ceiling is 4,300 ft.", "metar.KSFO.ceiling")],
                refusal="out_of_scope",
            ),
            BUNDLE,
        )


def test_verdict_language_in_a_claim_is_rejected():
    with pytest.raises(InvalidAnswerError, match="verdict language"):
        validate_answer(
            answer(
                "KSFO is VFR.",
                [
                    claim(
                        "You can fly this afternoon.",
                        "metar.KSFO.flight_category",
                    )
                ],
            ),
            BUNDLE,
        )


def test_verdict_language_in_the_summary_is_rejected():
    with pytest.raises(InvalidAnswerError, match="verdict language"):
        validate_answer(
            answer(
                "It is safe to fly.",
                [claim("The ceiling is 4,300 ft.", "metar.KSFO.ceiling")],
            ),
            BUNDLE,
        )


def test_number_with_and_without_a_comma_matches():
    result = validate_answer(
        answer(
            "KSFO is VFR.",
            [claim("The ceiling is 4300 ft.", "metar.KSFO.ceiling")],
        ),
        BUNDLE,
    )

    assert result.claims[0].text == "The ceiling is 4300 ft."


def test_a_real_bundle_accepts_a_grounded_claim():
    reference = datetime(2026, 11, 1, 9, 30, tzinfo=UTC)
    station = BriefStation(
        icao="KSFO",
        name="San Francisco Intl",
        lat=37.6196,
        lon=-122.3656,
        observation=parse_metar(
            "METAR KSFO 010856Z 27009KT 7SM RA FEW018 BKN024 OVC030 "
            "12/10 A2985",
            reference=reference,
        ),
    )
    bundle = build_brief([station], reference)

    result = validate_answer(
        answer(
            "KSFO has a broken layer.",
            [claim("The ceiling is 2,400 ft.", "metar.KSFO.ceiling")],
        ),
        bundle,
    )

    assert result.claims[0].refs == ("metar.KSFO.ceiling",)


def test_parse_model_answer_reads_a_draft():
    draft = parse_model_answer(
        {
            "summary": "KSFO is VFR.",
            "claims": [
                {
                    "text": "The ceiling is 4,300 ft.",
                    "refs": ["metar.KSFO.ceiling"],
                }
            ],
            "caveats": ["Observation is 6 minutes old."],
            "refusal_kind": None,
        }
    )

    assert draft.summary == "KSFO is VFR."
    assert draft.claims[0].refs == ("metar.KSFO.ceiling",)
    assert draft.caveats == ("Observation is 6 minutes old.",)


def test_parse_model_answer_rejects_a_bad_shape():
    with pytest.raises(ValueError, match="summary"):
        parse_model_answer({"claims": [], "caveats": []})
