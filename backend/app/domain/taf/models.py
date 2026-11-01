"""The forecast produced by a TAF report."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime

from app.domain.weather.models import CloudLayer, Visibility, Wind, lowest_ceiling

#: Labels for the first period and for each change group.
INITIAL = "INITIAL"
FM = "FM"
BECMG = "BECMG"
TEMPO = "TEMPO"
PROB = "PROB"
INTER = "INTER"

#: Fluctuations inside the prevailing period, not new periods.
TRANSIENT_CHANGES = frozenset({TEMPO, PROB, INTER, f"{PROB} {TEMPO}"})


@dataclass(frozen=True, slots=True)
class TafPeriod:
    change: str
    starts_at: datetime
    ends_at: datetime
    probability: int | None = None
    is_temporary: bool = False
    wind: Wind | None = None
    visibility: Visibility | None = None
    weather: tuple[str, ...] = ()
    clouds: tuple[CloudLayer, ...] = ()
    raw: str = ""

    @property
    def ceiling_ft(self) -> int | None:
        return lowest_ceiling(self.clouds)

    @property
    def visibility_sm(self) -> float | None:
        return None if self.visibility is None else self.visibility.statute_miles

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class Taf:
    station: str
    issued_at: datetime
    valid_from: datetime
    valid_to: datetime
    periods: tuple[TafPeriod, ...]
    raw: str
    is_amended: bool = False
    is_corrected: bool = False
    unparsed: tuple[str, ...] = ()

    @property
    def prevailing_periods(self) -> tuple[TafPeriod, ...]:
        return tuple(period for period in self.periods if not period.is_temporary)

    def as_dict(self) -> dict[str, object]:
        return asdict(self)
