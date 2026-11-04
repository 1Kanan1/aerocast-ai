from datetime import UTC, datetime

import pytest

from app.domain.taf import TafParseError, parse_taf
from app.domain.taf.windows import resolve_spec

REFERENCE = datetime(2026, 11, 1, 9, 30, tzinfo=UTC)


def parse(raw: str, reference: datetime = REFERENCE):
    return parse_taf(raw, reference=reference)


def test_parses_a_chain_of_fm_groups() -> None:
    taf = parse(
        "TAF KSFO 010859Z 0109/0212 30005KT 6SM -SHRA OVC035 "
        "FM011300 32007KT P6SM BKN050 FM012200 29013KT P6SM SKC "
        "FM020500 26003KT P6SM SKC"
    )

    assert taf.station == "KSFO"
    assert taf.issued_at == datetime(2026, 11, 1, 8, 59, tzinfo=UTC)
    assert taf.valid_from == datetime(2026, 11, 1, 9, 0, tzinfo=UTC)
    assert taf.valid_to == datetime(2026, 11, 2, 12, 0, tzinfo=UTC)
    assert [period.change for period in taf.periods] == [
        "INITIAL",
        "FM",
        "FM",
        "FM",
    ]

    initial, first, second, third = taf.periods
    assert initial.starts_at == datetime(2026, 11, 1, 9, 0, tzinfo=UTC)
    assert initial.ends_at == datetime(2026, 11, 1, 13, 0, tzinfo=UTC)
    assert initial.wind is not None
    assert initial.wind.direction_deg == 300
    assert initial.visibility_sm == 6
    assert initial.weather == ("-SHRA",)
    assert initial.ceiling_ft == 3500

    assert first.starts_at == datetime(2026, 11, 1, 13, 0, tzinfo=UTC)
    assert first.ends_at == datetime(2026, 11, 1, 22, 0, tzinfo=UTC)
    assert second.starts_at == datetime(2026, 11, 1, 22, 0, tzinfo=UTC)
    assert third.starts_at == datetime(2026, 11, 2, 5, 0, tzinfo=UTC)
    assert third.ends_at == taf.valid_to
    assert third.clouds == ()


def test_tempo_is_a_window_inside_the_prevailing_period() -> None:
    taf = parse(
        "TAF KXYZ 011130Z 0112/0212 20010KT P6SM SCT030 "
        "TEMPO 0115/0120 2SM TSRA BKN010CB"
    )

    assert len(taf.periods) == 2
    prevailing, tempo = taf.periods
    assert tempo.is_temporary is True
    assert tempo.starts_at == datetime(2026, 11, 1, 15, 0, tzinfo=UTC)
    assert tempo.ends_at == datetime(2026, 11, 1, 20, 0, tzinfo=UTC)
    assert tempo.visibility_sm == 2
    assert tempo.ceiling_ft == 1000
    assert "TSRA" in tempo.weather

    # The temporary window must not truncate the prevailing period.
    assert prevailing.ends_at == taf.valid_to
    assert taf.prevailing_periods == (prevailing,)


def test_probability_window() -> None:
    taf = parse(
        "TAF KXYZ 011130Z 0112/0212 20010KT P6SM SCT030 "
        "PROB30 TEMPO 0115/0118 1/2SM FG VV002"
    )

    probability = taf.periods[1]
    assert probability.probability == 30
    assert probability.is_temporary is True
    assert probability.change == "PROB TEMPO"
    assert probability.ceiling_ft == 200


def test_becmg_starts_a_new_prevailing_period() -> None:
    taf = parse(
        "TAF KXYZ 011130Z 0112/0212 20010KT P6SM SCT030 "
        "BECMG 0115/0118 25015KT BKN020"
    )

    initial, becoming = taf.periods
    assert initial.ends_at == datetime(2026, 11, 1, 15, 0, tzinfo=UTC)
    assert becoming.change == "BECMG"
    assert becoming.starts_at == datetime(2026, 11, 1, 15, 0, tzinfo=UTC)
    assert becoming.ends_at == taf.valid_to
    assert becoming.wind is not None and becoming.wind.speed_kt == 15
    assert becoming.ceiling_ft == 2000


def test_validity_window_across_a_month_boundary() -> None:
    taf = parse(
        "TAF KXYZ 302230Z 3022/0106 20008KT P6SM SKC",
        reference=datetime(2026, 10, 30, 22, 30, tzinfo=UTC),
    )

    assert taf.valid_from == datetime(2026, 10, 30, 22, 0, tzinfo=UTC)
    assert taf.valid_to == datetime(2026, 11, 1, 6, 0, tzinfo=UTC)


def test_amended_and_corrected_flags() -> None:
    taf = parse("TAF AMD KXYZ 011130Z 0112/0212 20010KT P6SM SKC")
    assert taf.is_amended is True

    corrected = parse("TAF COR KXYZ 011130Z 0112/0212 20010KT P6SM SKC")
    assert corrected.is_corrected is True


def test_issue_time_may_be_omitted() -> None:
    taf = parse("TAF KXYZ 0112/0212 20010KT P6SM SKC")

    assert taf.valid_from == datetime(2026, 11, 1, 12, 0, tzinfo=UTC)
    assert taf.issued_at == taf.valid_from


def test_four_digit_fm_spec_uses_the_previous_day() -> None:
    taf = parse(
        "TAF KXYZ 011130Z 0112/0212 20010KT P6SM SKC FM1800 25012KT P6SM SKC"
    )

    assert taf.periods[1].change == "FM"
    assert taf.periods[1].starts_at == datetime(2026, 11, 1, 18, 0, tzinfo=UTC)


def test_four_digit_fm_spec_rolls_into_the_next_day() -> None:
    taf = parse(
        "TAF KXYZ 011130Z 0118/0206 20010KT P6SM SKC FM0200 25012KT P6SM SKC"
    )

    assert taf.periods[1].starts_at == datetime(2026, 11, 2, 2, 0, tzinfo=UTC)


def test_forecast_groups_that_are_not_modelled_are_reported() -> None:
    taf = parse(
        "TAF KXYZ 011130Z 0112/0212 20010KT P6SM SKC TX20/0118Z TN10/0206Z"
    )

    assert taf.unparsed == ("TX20/0118Z", "TN10/0206Z")


def test_spec_resolution_rolls_forward_a_month() -> None:
    anchor = datetime(2026, 10, 30, 22, 0, tzinfo=UTC)

    assert resolve_spec("010600", anchor) == datetime(
        2026, 11, 1, 6, 0, tzinfo=UTC
    )


def test_hour_24_means_midnight_at_the_end_of_the_day() -> None:
    taf = parse(
        "TAF KXYZ 011130Z 0112/0224 20010KT P6SM SKC",
    )

    assert taf.valid_to == datetime(2026, 11, 3, 0, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        ("", "empty report"),
        ("TAF 011130Z 0112/0212 20010KT P6SM SKC", "invalid station"),
        ("TAF KXYZ 011130Z 20010KT P6SM SKC", "missing validity window"),
        (
            "TAF KXYZ 011130Z 0212/0112 20010KT P6SM SKC",
            "ends before it starts",
        ),
    ],
)
def test_invalid_reports_are_rejected(raw: str, message: str) -> None:
    with pytest.raises(TafParseError, match=message):
        parse(raw)
