"""The answer has two field lists, and they must stay the same list.

`wire_answer` builds the dict by hand and `models.Answer` declares the
response model. Adding a field to one and forgetting the other is silent:
the API returns it and the schema drops it, or the schema promises it and
the dict never sets it. This test makes that a red build instead.
"""

from __future__ import annotations

from app.api import models
from app.llm.contract import Answer, wire_answer


def test_the_wire_answer_and_the_response_model_carry_the_same_fields() -> (
    None
):
    wire = wire_answer(Answer(summary="", claims=(), caveats=(), refusal=None))

    assert set(wire) == set(models.Answer.model_fields)
