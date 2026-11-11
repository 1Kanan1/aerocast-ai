from datetime import UTC, datetime
from typing import Any

from app.domain.brief import BriefAdvisory, BriefStation, build_brief, refs_in
from app.domain.metar import parse_metar
from app.domain.taf import parse_taf

GENERATED_AT = datetime(2026, 11, 1, 9, 30, tzinfo=UTC)
REFERENCE = datetime(2026, 11, 1, 9, 30, tzinfo=UTC)

METAR = (
    "METAR KSFO 010856Z 27009KT 7SM RA FEW018 BKN024 OVC030 12/10 A2985 "
    "RMK AO2 SLP107 P0014 T01220100"
)
TAF = (
    "TAF KSFO 010859Z 0109/0212 30005KT 6SM -SHRA OVC035 "
    "FM011300 32007KT P6SM BKN050 FM012200 29013KT P6SM SKC"
)


def station(with_taf: bool = True) -> BriefStation:
    return BriefStation(
        icao="KSFO",
        name="San Francisco Intl, CA, US",
        lat=37.6196,
        lon=-122.3656,
        observation=parse_metar(METAR, reference=REFERENCE),
        taf=parse_taf(TAF, reference=REFERENCE) if with_taf else None,
        advisories=(
            BriefAdvisory(
                kind="gairmet",
                hazard="IFR",
                valid_to=datetime(2026, 11, 1, 15, 0, tzinfo=UTC),
                distance_nm=12.0,
                due_to="CEILING AND VISIBILITY",
            ),
        ),
    )


def brief_for(with_taf: bool = True) -> dict[str, Any]:
    return build_brief([station(with_taf=with_taf)], GENERATED_AT)


def test_bundle_carries_the_observation_with_a_basis() -> None:
    bundle = brief_for()
    metar = bundle["stations"][0]["metar"]

    assert metar["ref"] == "metar.KSFO"
    assert (
        metar["observed_at"]
        == datetime(2026, 11, 1, 8, 56, tzinfo=UTC).isoformat()
    )
    assert metar["age_seconds"] == 34 * 60
    assert metar["flight_category"]["value"] == "MVFR"
    assert "2,400 ft" in metar["flight_category"]["basis"]
    assert metar["ceiling"]["ft"] == 2400
    assert metar["wind"]["speed_kt"] == 9
    assert metar["temperature"]["dewpoint_spread_c"] == 2.2


def test_bundle_carries_humidity_drawn_from_the_report_itself() -> None:
    bundle = brief_for()
    humidity = bundle["stations"][0]["metar"]["humidity"]

    assert humidity == {"ref": "metar.KSFO.humidity", "relative_pct": 86}


def test_bundle_carries_the_forecast_chain() -> None:
    bundle = brief_for()
    taf = bundle["stations"][0]["taf"]

    assert taf["ref"] == "taf.KSFO"
    assert [period["change"] for period in taf["periods"]] == [
        "INITIAL",
        "FM",
        "FM",
    ]
    assert taf["periods"][0]["ref"] == "taf.KSFO.period.0"
    assert taf["periods"][0]["ceiling_ft"] == 3500


def test_advisories_carry_their_own_refs() -> None:
    bundle = brief_for()
    advisories = bundle["stations"][0]["advisories"]

    assert advisories[0]["ref"] == "adv.KSFO.0"
    assert advisories[0]["hazard"] == "IFR"
    assert advisories[0]["distance_nm"] == 12.0


def test_missing_reports_are_null_rather_than_absent() -> None:
    bundle = brief_for(with_taf=False)
    station_brief = bundle["stations"][0]

    assert station_brief["metar"] is not None
    assert station_brief["taf"] is None


def test_bundle_hash_is_deterministic() -> None:
    first = brief_for()
    second = brief_for()

    assert first["brief_hash"] == second["brief_hash"]
    assert str(first["brief_hash"]).startswith("sha256:")


def test_bundle_hash_changes_when_a_fact_changes() -> None:
    changed = BriefStation(
        icao="KSFO",
        name="San Francisco Intl, CA, US",
        lat=37.6196,
        lon=-122.3656,
        observation=parse_metar(
            "METAR KSFO 010856Z 27009KT 7SM FEW018 BKN024 OVC030 12/10 A2985",
            reference=REFERENCE,
        ),
    )

    assert (
        build_brief([changed], GENERATED_AT)["brief_hash"]
        != brief_for()["brief_hash"]
    )


def test_age_never_goes_negative() -> None:
    bundle = build_brief([station()], datetime(2026, 11, 1, 8, 0, tzinfo=UTC))
    metar = bundle["stations"][0]["metar"]

    assert metar["age_seconds"] == 0


def test_every_ref_is_unique_and_discoverable() -> None:
    bundle = brief_for()
    refs = refs_in(bundle)

    assert len(refs) == len(set(refs))
    assert {
        "metar.KSFO",
        "metar.KSFO.flight_category",
        "metar.KSFO.wind",
        "metar.KSFO.visibility",
        "metar.KSFO.ceiling",
        "metar.KSFO.temperature",
        "taf.KSFO",
        "taf.KSFO.period.0",
        "adv.KSFO.0",
    } <= set(refs)


def test_definitions_are_shipped_with_the_bundle() -> None:
    definitions = brief_for()["definitions"]

    assert definitions["MVFR"].startswith("Ceiling 1,000 to 3,000 ft")
    assert "TEMPO" in definitions
