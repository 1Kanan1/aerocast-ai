# METAR cross-check

- parser: `metar-1.1.0`
- generated: 2026-11-01T15:52:28+04:00
- source: https://aviationweather.gov/data/cache/metars.cache.csv.gz
- observations: 2,373 parsed, 0 skipped, 2,373 rows considered

| Field | Compared | Agree | Disagree | Missing | Agreement |
| --- | ---: | ---: | ---: | ---: | ---: |
| temperature | 2,349 | 2,348 | 1 | 24 | 99.96% |
| dewpoint | 2,337 | 2,337 | 0 | 36 | 100.00% |
| wind_direction | 2,342 | 2,342 | 0 | 31 | 100.00% |
| wind_speed | 2,342 | 2,342 | 0 | 31 | 100.00% |
| wind_gust | 82 | 82 | 0 | 2,291 | 100.00% |
| visibility | 2,303 | 2,303 | 0 | 70 | 100.00% |
| altimeter | 2,366 | 2,366 | 0 | 7 | 100.00% |
| clouds | 1,806 | 1,806 | 0 | 567 | 100.00% |
| flight_category | 2,303 | 2,302 | 1 | 70 | 99.96% |

Agreement is measured only where both decoders produced a value. `Missing`
counts rows where one side had nothing, which is usually a group the other
decoder does not model rather than a mistake.

### temperature: 1 disagreements

- `KC62` KC62 METAR KC62 011135Z AUTO 00000KT 10SM OVC100 08/06 A3039 RMK AO2 T00910066 | temp ours=9.1 awc=8.0

### flight_category: 1 disagreements

- `KS24` KS24 METAR KS24 011117Z AUTO 10003KT 10SM BKN070 OVC010 10/08 A3038 RMK AO2 | category ours=MVFR awc=VFR ceiling=1000 vis=10.0
