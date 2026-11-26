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
    assert metar["age_minutes"] == 34
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


def test_bundle_hash_is_stable_as_time_passes() -> None:
    later = datetime(2026, 11, 1, 9, 45, tzinfo=UTC)
    first = build_brief([station()], GENERATED_AT)
    second = build_brief([station()], later)

    assert first["brief_hash"] == second["brief_hash"]
    assert (
        first["stations"][0]["metar"]["age_seconds"]
        != second["stations"][0]["metar"]["age_seconds"]
    )


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
    assert "METAR" in definitions
    assert "TAF" in definitions
    assert "BKN" in definitions
    assert "SIGMET" in definitions


def test_bundle_summarizes_observation_history() -> None:
    earlier = parse_metar(
        "METAR KSFO 312056Z 28014G20KT 10SM FEW035 16/09 A2992",
        reference=datetime(2026, 10, 31, 21, 0, tzinfo=UTC),
    )
    stale = parse_metar(
        "METAR KSFO 290056Z 28005KT 10SM SKC 18/08 A3000",
        reference=datetime(2026, 10, 29, 1, 0, tzinfo=UTC),
    )
    latest = parse_metar(METAR, reference=REFERENCE)
    built = BriefStation(
        icao="KSFO",
        name="San Francisco Intl",
        lat=37.6196,
        lon=-122.3656,
        distance_nm=4.2,
        observation=latest,
        history=(stale, latest, earlier),
    )
    bundle = build_brief([built], GENERATED_AT)
    station_brief = bundle["stations"][0]
    history = station_brief["history"]

    assert station_brief["distance_nm"] == 4.2
    assert history["ref"] == "history.KSFO"
    assert history["observation_count"] == 2
    assert history["category_counts"] == {"VFR": 1, "MVFR": 1}
    assert history["ceiling_ft_min"] == 2400
    assert history["ceiling_ft_max"] == 2400
    assert history["visibility_sm_min"] == 7.0
    assert history["visibility_sm_max"] == 10.0
    assert history["max_wind_kt"] == 20
    assert history["temperature_c_min"] == 12.2
    assert history["temperature_c_max"] == 16.0
    assert len(history["checkpoints"]) == 2
    assert "history.KSFO" in refs_in(bundle)


def test_bundle_summarizes_forecast_history() -> None:
    older_taf = parse_taf(
        "TAF KSFO 010259Z 0103/0206 29012G18KT 5SM BR OVC015",
        reference=datetime(2026, 11, 1, 3, 0, tzinfo=UTC),
    )
    amended_taf = parse_taf(
        "TAF AMD KSFO 010859Z 0109/0212 30005KT 6SM -SHRA OVC035 "
        "FM011300 32007KT P6SM BKN050",
        reference=REFERENCE,
    )
    built = BriefStation(
        icao="KSFO",
        name="San Francisco Intl",
        lat=37.6196,
        lon=-122.3656,
        taf=amended_taf,
        taf_history=(amended_taf, older_taf),
    )
    bundle = build_brief([built], GENERATED_AT)
    taf_history = bundle["stations"][0]["taf_history"]

    assert taf_history["ref"] == "taf.KSFO.history"
    assert taf_history["forecast_count"] == 2
    assert taf_history["amended_count"] == 1
    assert taf_history["corrected_count"] == 0
    assert len(taf_history["issuances"]) == 2
    assert taf_history["issuances"][0]["min_ceiling_ft"] == 1500
    assert taf_history["issuances"][0]["max_wind_kt"] == 18
    assert taf_history["issuances"][1]["is_amended"] is True
    assert taf_history["issuances"][1]["weather"] == ["-SHRA"]
    assert "taf.KSFO.history" in refs_in(bundle)


def test_area_bundle_computes_distance_weighted_area_summary() -> None:
    near = BriefStation(
        icao="KFHM",
        name="LA Downtown",
        lat=34.07,
        lon=-118.24,
        distance_nm=1.0,
        observation=parse_metar(
            "METAR KFHM 010856Z 27010KT 10SM BKN035 18/10 A2992",
            reference=REFERENCE,
        ),
    )
    far = BriefStation(
        icao="KEMT",
        name="El Monte",
        lat=34.09,
        lon=-118.03,
        distance_nm=9.0,
        observation=parse_metar(
            "METAR KEMT 010856Z 27006KT 6SM BKN015 11/09 A2992",
            reference=REFERENCE,
        ),
    )
    assert brief_for()["area_summary"] is None

    bundle = build_brief([near, far], GENERATED_AT)
    summary = bundle["area_summary"]
    assert summary["ref"] == "area.summary"
    assert "area.summary" in refs_in(bundle)
    assert summary["station_count"] == 2
    assert summary["reporting_count"] == 2
    # Weights: near = 1/2 = 0.5, far = 1/10 = 0.1 -> (18*0.5 + 11*0.1)/0.6
    assert summary["temperature_c"] == {
        "weighted_avg": 16.8,
        "min": 11.0,
        "max": 18.0,
        "min_station": "KEMT",
        "max_station": "KFHM",
    }
    assert summary["ceiling_ft"]["weighted_avg"] == 3200
    assert summary["wind"]["direction_deg"] == 270
    assert summary["wind"]["speed_kt"] == 9
