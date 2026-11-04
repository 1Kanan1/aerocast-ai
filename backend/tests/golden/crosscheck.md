# METAR cross-check

- parser: `metar-1.1.0`
- generated: 2026-11-04T14:02:24+04:00
- source: https://aviationweather.gov/data/cache/metars.cache.csv.gz
- observations: 2,556 parsed, 0 skipped, 2,556 rows considered

| Field | Compared | Agree | Disagree | Missing | Agreement |
| --- | ---: | ---: | ---: | ---: | ---: |
| temperature | 2,529 | 2,529 | 0 | 27 | 100.00% |
| dewpoint | 2,511 | 2,511 | 0 | 45 | 100.00% |
| wind_direction | 2,521 | 2,521 | 0 | 35 | 100.00% |
| wind_speed | 2,521 | 2,521 | 0 | 35 | 100.00% |
| wind_gust | 268 | 268 | 0 | 2,288 | 100.00% |
| visibility | 2,475 | 2,475 | 0 | 81 | 100.00% |
| altimeter | 2,548 | 2,548 | 0 | 8 | 100.00% |
| clouds | 1,421 | 1,420 | 1 | 1,135 | 99.93% |
| flight_category | 2,477 | 2,477 | 0 | 79 | 100.00% |

Agreement counts only rows where both decoders produced a value.
`Missing` counts rows where one side had nothing, usually a group the
other decoder does not model.

### clouds: 1 disagreements

- `KBKT` KBKT METAR KBKT 040955Z AUTO 00000KT 1/2SM R22/2600V3500FT FG FEW000 10/10 A3018 RMK AO2 SLP222 T01030101 | clouds ours=FEW0 awc=-
