from datetime import UTC, datetime

import pytest

from app.domain.metar import IFR, LIFR, MVFR, VFR, category_for, classify, parse_metar
from app.domain.metar.flight_category import FlightCategory
from app.domain.metar.flight_category import category_for as raw_category_for

REFERENCE = datetime(2026, 11, 1, 9, 30, tzinfo=UTC)


@pytest.mark.parametrize(
    ("ceiling_ft", "visibility_sm", "expected"),
    [
        (None, 10, VFR),
        (5000, 10, VFR),
        (3001, 6, VFR),
        (3000, 10, MVFR),
        (2000, 10, MVFR),
        (1000, 10, MVFR),
        (None, 5, MVFR),
        (None, 3, MVFR),
        (999, 10, IFR),
        (500, 10, IFR),
        (None, 2.9, IFR),
        (None, 1, IFR),
        (499, 10, LIFR),
        (None, 0.9, LIFR),
        (None, 0.25, LIFR),
        (200, 10, LIFR),
        (2000, 0.5, LIFR),
        (800, 10, IFR),
        (20000, 2, IFR),
    ],
)
def test_category_bands(ceiling_ft: int | None, visibility_sm: float | None, expected: str) -> None:
    assert raw_category_for(ceiling_ft, visibility_sm) == expected


def test_unknown_inputs_produce_no_category() -> None:
    assert category_for(None, None) is None


def test_missing_visibility_produces_no_category() -> None:
    # AWC publishes no category either: without visibility only half the definition is known.
    assert category_for(800, None) is None
    assert category_for(None, None) is None


def test_classify_explains_its_reasoning() -> None:
    observation = parse_metar(
        "METAR KSFO 010856Z 27009KT 7SM RA FEW018 BKN024 OVC030 12/10 A2985",
        reference=REFERENCE,
    )

    category = classify(observation)

    assert isinstance(category, FlightCategory)
    assert category.category == MVFR
    assert category.ceiling_ft == 2400
    assert category.visibility_sm == 7
    assert "2,400 ft" in category.basis
    assert "broken" in category.basis
    assert "visibility 7 SM" in category.basis


def test_classify_reports_no_ceiling_when_sky_is_clear() -> None:
    observation = parse_metar(
        "METAR KASE 010853Z 34005KT 10SM CLR 02/M02 A3011",
        reference=REFERENCE,
    )

    category = classify(observation)

    assert category.category == VFR
    assert "no ceiling" in category.basis


def test_classify_preserves_the_visibility_qualifier() -> None:
    observation = parse_metar(
        "KXYZ 011200Z 00000KT M1/4SM FG VV002 10/10 A3000",
        reference=REFERENCE,
    )

    category = classify(observation)

    assert category.category == LIFR
    assert "less than 0.25 SM" in category.basis


def test_ceiling_is_the_lowest_layer_even_when_reported_out_of_order() -> None:
    # KS24 reports BKN070 before OVC010. The FAA ceiling is the lowest broken or
    # overcast layer, so 1,000 ft is correct. AWC's decoder uses document order and
    # publishes VFR, which is the one flight-category disagreement in the cross-check.
    observation = parse_metar(
        "KS24 011117Z AUTO 10003KT 10SM BKN070 OVC010 10/08 A3038 RMK AO2",
        reference=REFERENCE,
    )

    assert observation.ceiling_ft == 1000
    assert classify(observation).category == MVFR


def test_category_serialises_for_storage() -> None:
    category = classify(
        parse_metar("KXYZ 011200Z 00000KT 1/2SM FG OVC003 10/10 A3000", reference=REFERENCE)
    )

    assert category.as_dict() == {
        "category": LIFR,
        "ceiling_ft": 300,
        "visibility_sm": 0.5,
        "basis": "ceiling 300 ft overcast, visibility 0.5 SM",
    }
