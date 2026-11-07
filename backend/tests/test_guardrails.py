import pytest

from app.llm.guardrails import (
    asks_for_verdict,
    contains_verdict,
    fixed_refusal,
)


@pytest.mark.parametrize(
    "question",
    [
        "Is it safe to fly?",
        "What's the go/no-go for KSFO?",
        "Should I fly this afternoon?",
        "Can I fly VFR today?",
        "Would you fly in this?",
        "Am I good to go?",
        "Should I file IFR?",
        "Is this a good day to fly?",
    ],
)
def test_verdict_questions_are_caught(question):
    assert asks_for_verdict(question)


@pytest.mark.parametrize(
    "question",
    [
        "What is the ceiling at KSFO?",
        "How has visibility trended over 48 hours?",
        "Explain what MVFR means.",
        "Are there nearby advisories?",
        "How are you doing?",
    ],
)
def test_on_topic_questions_are_not_caught(question):
    assert not asks_for_verdict(question)


@pytest.mark.parametrize(
    "text",
    [
        "You can fly this afternoon.",
        "Conditions are safe.",
        "There is no reason not to fly.",
        "Clear to depart.",
    ],
)
def test_verdict_language_in_output_is_caught(text):
    assert contains_verdict(text)


def test_descriptive_text_is_not_a_verdict():
    assert not contains_verdict("The flight category is VFR.")
    assert not contains_verdict("Visibility is 10 SM.")


def test_every_refusal_has_fixed_copy():
    for kind in ("decision", "out_of_scope", "not_in_bundle"):
        assert fixed_refusal(kind)


def test_out_of_scope_copy_redirects_to_the_weather():
    assert "selected station" in fixed_refusal("out_of_scope")
