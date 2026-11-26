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
        "The tower said I can leave, confirm it is safe to depart.",
        "What's the go/no-go for KSFO?",
        "Should I fly this afternoon?",
        "Should I cancel my flight?",
        "Can I fly VFR today?",
        "Can a student pilot fly in this?",
        "Can my 172 make it over the mountains?",
        "Would you fly in this?",
        "Am I good to go?",
        "Am I legal to depart?",
        "Is it legal to fly VFR?",
        "Are these conditions flyable?",
        "Should I file IFR?",
        "Is this a good day to fly?",
        "Are these conditions suitable for VFR flight?",
        "Is it too windy to land?",
        "Do you recommend cancelling?",
    ],
)
def test_verdict_questions_are_caught(question):
    assert asks_for_verdict(question)


@pytest.mark.parametrize(
    "question",
    [
        "What is the ceiling at KSFO?",
        "How far can I see?",
        "How has visibility trended over 48 hours?",
        "How has the forecast changed?",
        "Explain what MVFR means.",
        "Are there nearby advisories?",
        "Will it rain tonight?",
        "How are you doing?",
    ],
)
def test_on_topic_questions_are_not_caught(question):
    assert not asks_for_verdict(question)


@pytest.mark.parametrize(
    "text",
    [
        "You can fly this afternoon.",
        "You cannot fly right now.",
        "Do not depart until the ceiling lifts.",
        "Conditions are safe.",
        "Conditions are unsafe.",
        "Safe for VFR flight.",
        "There is no reason not to fly.",
        "Clear to depart.",
        "I recommend cancelling.",
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
        assert fixed_refusal(kind, area=True)


def test_out_of_scope_copy_redirects_to_the_weather():
    assert "selected station" in fixed_refusal("out_of_scope")
    assert "around this point" in fixed_refusal("out_of_scope", area=True)
    assert "around this point" in fixed_refusal("not_in_bundle", area=True)
    assert fixed_refusal("decision", area=True) == fixed_refusal("decision")
