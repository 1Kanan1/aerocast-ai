from datetime import UTC, datetime

import pytest

from app.domain.metar import MetarParseError, parse_metar

REFERENCE = datetime(2026, 11, 1, 9, 30, tzinfo=UTC)


def parse(raw: str, reference: datetime = REFERENCE):
    return parse_metar(raw, reference=reference)


def test_parses_a_full_us_report() -> None:
    observation = parse(
        "METAR KSFO 010856Z 27009KT 7SM RA FEW018 BKN024 OVC030 12/10 A2985 "
        "RMK AO2 SLP107 P0014 60017 T01220100 55001 $"
    )

    assert observation.station == "KSFO"
    assert observation.report_type == "METAR"
    assert observation.observed_at == datetime(2026, 11, 1, 8, 56, tzinfo=UTC)
    assert observation.wind is not None
    assert observation.wind.direction_deg == 270
    assert observation.wind.speed_kt == 9
    assert observation.wind.gust_kt is None
    assert observation.visibility_sm == 7
    assert observation.weather == ("RA",)
    assert [layer.cover for layer in observation.clouds] == [
        "FEW",
        "BKN",
        "OVC",
    ]
    assert observation.ceiling_ft == 2400
    assert observation.temperature_c == 12.2
    assert observation.dewpoint_c == 10.0
    assert observation.altimeter_in_hg == 29.85
    assert observation.altimeter_hpa == pytest.approx(1010.8, abs=0.05)
    assert observation.remarks is not None and observation.remarks.startswith(
        "AO2"
    )
    assert observation.unparsed == ()


def test_clear_sky_means_no_ceiling() -> None:
    observation = parse(
        "METAR KASE 010853Z 34005KT 10SM CLR 02/M02 A3011 "
        "RMK AO2 SLP125 T00221017 58018 $"
    )

    assert observation.clouds == ()
    assert observation.ceiling_ft is None
    # The remarks T-group carries tenths and wins over the rounded body group.
    assert observation.temperature_c == 2.2
    assert observation.dewpoint_c == -1.7
    assert observation.altimeter_in_hg == 30.11


def test_scattered_layer_is_not_a_ceiling() -> None:
    observation = parse(
        "METAR KJFK 010851Z 36006KT 10SM SCT250 07/02 A3052 "
        "RMK AO2 SLP333 51008 $"
    )

    assert observation.ceiling_ft is None
    assert observation.visibility_sm == 10


def test_calm_and_variable_winds() -> None:
    calm = parse("KXYZ 011200Z 00000KT 10SM SKC 10/05 A3000")
    assert calm.wind is not None
    assert calm.wind.speed_kt == 0
    assert calm.wind.is_calm is True

    variable = parse("KXYZ 011200Z VRB03KT 10SM SKC 10/05 A3000")
    assert variable.wind is not None
    assert variable.wind.direction_deg is None
    assert variable.wind.is_variable is True
    assert variable.wind.speed_kt == 3


def test_gusts_and_direction_variation() -> None:
    observation = parse(
        "KXYZ 011200Z 24018G32KT 210V270 10SM SCT040 10/05 A3000"
    )

    assert observation.wind is not None
    assert observation.wind.speed_kt == 18
    assert observation.wind.gust_kt == 32
    assert observation.wind.variation_from_deg == 210
    assert observation.wind.variation_to_deg == 270


def test_wind_units_are_converted_to_knots() -> None:
    observation = parse("UEEE 011200Z 24010MPS 9999 SCT040 10/05 Q1013")

    assert observation.wind is not None
    assert observation.wind.speed_kt == 19  # 10 m/s


@pytest.mark.parametrize(
    ("token", "miles", "greater_than", "less_than"),
    [
        ("10SM", 10.0, False, False),
        ("1/2SM", 0.5, False, False),
        ("M1/4SM", 0.25, False, True),
        ("P6SM", 6.0, True, False),
        ("0800", 0.5, False, False),
        ("9999", 6.21, True, False),
    ],
)
def test_visibility_forms(
    token: str, miles: float, greater_than: bool, less_than: bool
) -> None:
    observation = parse(f"KXYZ 011200Z 00000KT {token} SKC 10/05 A3000")

    assert observation.visibility is not None
    assert observation.visibility.statute_miles == pytest.approx(
        miles, abs=0.01
    )
    assert observation.visibility.is_greater_than is greater_than
    assert observation.visibility.is_less_than is less_than


def test_mixed_fraction_visibility_uses_two_tokens() -> None:
    observation = parse("KXYZ 011200Z 00000KT 1 1/2SM BR BKN008 10/09 A3000")

    assert observation.visibility_sm == 1.5
    assert observation.unparsed == ()


def test_cavok_sets_visibility_and_clear_conditions() -> None:
    observation = parse("EGLL 011150Z 24010KT CAVOK 15/08 Q1013")

    assert observation.is_cavok is True
    assert observation.visibility is not None
    assert observation.visibility.is_greater_than is True
    assert observation.altimeter_in_hg == pytest.approx(29.91, abs=0.01)


def test_vertical_visibility_counts_as_a_ceiling() -> None:
    observation = parse("KXYZ 011200Z 00000KT 1/4SM FG VV002 10/10 A3000")

    assert observation.ceiling_ft == 200
    assert observation.ceiling_layer is not None
    assert observation.ceiling_layer.cover == "VV"


def test_thunderstorm_cloud_type_is_kept() -> None:
    observation = parse(
        "KXYZ 011200Z 18015G25KT 5SM TSRA BKN030CB 22/20 A2990"
    )

    assert observation.clouds[0].cloud_type == "CB"
    assert observation.weather == ("TSRA",)


def test_automated_and_corrected_flags() -> None:
    observation = parse(
        "SPECI KXYZ 011200Z AUTO COR 00000KT 1/4SM FG VV001 10/10 A3000"
    )

    assert observation.report_type == "SPECI"
    assert observation.is_automated is True
    assert observation.is_corrected is True


def test_body_group_is_used_when_remarks_are_absent() -> None:
    observation = parse("KXYZ 011200Z 00000KT 10SM SKC 10/05 A3000")

    assert observation.temperature_c == 10
    assert observation.dewpoint_c == 5


def test_temperature_group_without_a_dewpoint_half() -> None:
    # Real reports in the cache omit the dewpoint half entirely: T0178, T0072.
    observation = parse(
        "KPVG 011056Z AUTO 00000KT 10SM CLR 07/ A3050 RMK AO2 SLP329 T0072 $"
    )

    assert observation.temperature_c == 7.2
    assert observation.dewpoint_c is None


def test_temperature_group_with_masked_dewpoint_digits() -> None:
    observation = parse(
        "KETN 011110Z AUTO 00000KT 3/4SM BR VV005 15/ A3014 RMK AO2 T0151////"
    )

    assert observation.temperature_c == 15.1
    assert observation.dewpoint_c is None


def test_temperature_group_can_be_negative() -> None:
    observation = parse(
        "KXYZ 011200Z 00000KT 10SM SKC M02/M05 A3000 RMK AO2 T10171022"
    )

    assert observation.temperature_c == -1.7
    assert observation.dewpoint_c == -2.2


def test_unknown_tokens_are_reported_not_raised() -> None:
    observation = parse("EGLL 011150Z 24010KT 9999 SCT035 15/08 Q1013 NOSIG")

    assert observation.unparsed == ("NOSIG",)
    assert observation.clouds[0].cover == "SCT"


def test_day_resolves_into_the_previous_month() -> None:
    reference = datetime(2026, 3, 1, 0, 30, tzinfo=UTC)

    observation = parse(
        "KXYZ 282300Z 00000KT 10SM SKC 10/05 A3000", reference=reference
    )

    assert observation.observed_at == datetime(2026, 2, 28, 23, 0, tzinfo=UTC)


def test_day_that_does_not_exist_in_the_reference_month_is_clamped() -> None:
    reference = datetime(2026, 3, 1, 0, 30, tzinfo=UTC)

    observation = parse(
        "KXYZ 310600Z 00000KT 10SM SKC 10/05 A3000", reference=reference
    )

    assert observation.observed_at == datetime(2026, 2, 28, 6, 0, tzinfo=UTC)


def test_recent_timestamp_in_the_same_month_stays_put() -> None:
    reference = datetime(2026, 11, 1, 18, 0, tzinfo=UTC)

    observation = parse(
        "KXYZ 011700Z 00000KT 10SM SKC 10/05 A3000", reference=reference
    )

    assert observation.observed_at == datetime(2026, 11, 1, 17, 0, tzinfo=UTC)


def test_impossible_future_timestamp_rolls_back_a_month() -> None:
    # A 17:00Z observation cannot exist at 09:30Z on the 1st, so it
    # belongs to last month.
    observation = parse("KXYZ 011700Z 00000KT 10SM SKC 10/05 A3000")

    assert observation.observed_at == datetime(2026, 10, 1, 17, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        ("", "empty report"),
        ("METAR 010856Z 27009KT 10SM SKC 12/10 A2985", "invalid station"),
        (
            "METAR KSFO 27009KT 10SM SKC 12/10 A2985",
            "missing observation time",
        ),
    ],
)
def test_reports_without_an_anchor_are_rejected(
    raw: str, message: str
) -> None:
    with pytest.raises(MetarParseError, match=message):
        parse(raw)
