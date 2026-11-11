from app.domain.weather.humidity import relative_humidity_pct


def test_humidity_grows_as_the_dewpoint_nears_the_temperature() -> None:
    assert relative_humidity_pct(23, 12) == 50
    assert relative_humidity_pct(10, 10) == 100


def test_humidity_needs_both_readings() -> None:
    assert relative_humidity_pct(None, 12) is None
    assert relative_humidity_pct(12, None) is None
