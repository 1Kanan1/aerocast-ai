# METAR cross-check

- parser: `metar-1.1.0`
- generated: 2026-11-04T16:24:41+04:00
- source: https://aviationweather.gov/data/cache/metars.cache.csv.gz
- observations: 2,542 parsed, 0 skipped, 2,542 rows considered

| Field | Compared | Agree | Disagree | Missing | Agreement |
| --- | ---: | ---: | ---: | ---: | ---: |
| temperature | 2,516 | 2,516 | 0 | 26 | 100.00% |
| dewpoint | 2,496 | 2,496 | 0 | 46 | 100.00% |
| wind_direction | 2,503 | 2,503 | 0 | 39 | 100.00% |
| wind_speed | 2,503 | 2,503 | 0 | 39 | 100.00% |
| wind_gust | 257 | 257 | 0 | 2,285 | 100.00% |
| visibility | 2,466 | 2,466 | 0 | 76 | 100.00% |
| altimeter | 2,535 | 2,534 | 1 | 7 | 99.96% |
| clouds | 1,445 | 1,442 | 3 | 1,097 | 99.79% |
| flight_category | 2,467 | 2,467 | 0 | 75 | 100.00% |

Agreement counts only rows where both decoders produced a value.
`Missing` counts rows where one side had nothing, usually a group the
other decoder does not model.

### altimeter: 1 disagreements

- `PLCH` PLCH METAR PLCH 041200Z VRB01KT 9999 FEW020 28/25 Q1009 | altim ours=29.8 awc=29.79

### clouds: 3 disagreements

- `KNUC` KNUC SPECI KNUC 041213Z AUTOpZE)SSCT024 18/13 A2995 RMK AO2 T01780133 $  | clouds ours=- awc=SCT2400
- `KNPA` KNPA METAR KNPA 041156Z 00000KT 1/4SM FG BKN000 BKN250 20/20 A2989 RMK AO2 SLP122 FG BKN000 70003 T02000200 10228 20200 50010 $ | clouds ours=BKN0 BKN25000 awc=BKN25000
- `KBKT` KBKT METAR KBKT 041155Z AUTO 00000KT 1/4SM R22/2000V2600FT FG FEW000 10/10 A3017 RMK AO2 SLP220 T00970095 10125 20082 50000 | clouds ours=FEW0 awc=-
