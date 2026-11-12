from datetime import UTC, datetime

from app.domain.brief import BriefStation, build_brief
from app.domain.metar import parse_metar
from app.llm.fallback import NOTICE, fallback_answer, template_summary

REFERENCE = datetime(2026, 11, 1, 9, 30, tzinfo=UTC)
METAR = "METAR KSFO 010856Z 27009KT 7SM RA FEW018 BKN024 OVC030 12/10 A2985"


def bundle(with_metar: bool = True) -> dict[str, object]:
    return build_brief(
        [
            BriefStation(
                icao="KSFO",
                name="San Francisco Intl",
                lat=37.6196,
                lon=-122.3656,
                observation=parse_metar(METAR, reference=REFERENCE)
                if with_metar
                else None,
            )
        ],
        REFERENCE,
    )


def test_template_uses_the_station_facts():
    summary = template_summary(bundle())

    assert "KSFO" in summary
    assert "MVFR" in summary
    assert "2,400 ft" in summary
    assert "7 SM" in summary
    assert "270° at 9 kt" in summary


def test_template_says_when_there_is_no_observation():
    assert "no observation" in template_summary(bundle(with_metar=False))


def multi_station_bundle() -> dict[str, object]:
    return build_brief(
        [
            BriefStation(
                icao="KNEAR",
                name="Nearest Field",
                lat=37.62,
                lon=-122.36,
                observation=None,
            ),
            BriefStation(
                icao="KBFI",
                name="Boeing Field",
                lat=47.53,
                lon=-122.3,
                observation=parse_metar(METAR, reference=REFERENCE),
            ),
        ],
        REFERENCE,
    )


def test_template_prefers_a_station_that_has_a_report():
    summary = template_summary(multi_station_bundle())

    assert "KBFI" in summary
    assert "KNEAR" not in summary


def test_fallback_adds_a_neutral_notice():
    answer = fallback_answer(bundle())

    assert answer.notice == NOTICE
    assert answer.claims == ()
    assert answer.refusal is None
    assert "invalid" not in answer.notice.lower()
    assert "error" not in answer.notice.lower()
