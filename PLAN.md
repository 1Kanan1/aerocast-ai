# AeroCast AI: build plan

An educational aviation weather reader. Interactive map, decoded METAR/TAF, 48 hour
history, active advisories, and an explanation layer that can only explain verified
facts it was handed.

This is a portfolio build, not a product launch. That shapes every tradeoff below.
Optimize for: a reviewer can clone it, run one command, and see something real; and
the parts they read in the source show engineering judgment.

## 1. Positioning

AeroCast sits between two things that beat it:

- aviationweather.gov, which is free, official, and already has a map with METARs,
  TAFs and advisories
- ForeFlight and friends, which own the paid market and do everything this does
  plus NOTAMs, TFRs, charts, routing, and offline maps

We are not competing with either, and the README should say so plainly. What we
actually do better than the free site:

1. **History.** AWC is snapshot oriented. "How has KSFO trended over 48 hours" is a
   real question for fog and ceilings, and the site doesn't answer it.
2. **Plain English with citations.** A student pilot reading `BKN008 OVC012 1 1/2SM BR`
   needs the explanation, and every sentence needs a link back to the field it came from.

Everything else is table stakes for looking credible.

### Not in scope

No flight planning, no route weather, no NOTAMs (FAA retired the Federal NOTAM System
on 2026-04-18 for NMS, which needs developer enrollment), no TFRs, no charts, no
accounts, no go/no-go anything.

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| API | FastAPI, Python 3.13, Pydantic v2 | async ingestion, and the parser is the interesting code, so it should be easy to test |
| DB | PostgreSQL 16 | advisory geometry as GeoJSON in `jsonb`, with shapely for point-in-polygon and bbox work |
| Frontend | Remix 3 (v3.1.x) | requested. Non-React, own component model, no build step |
| Frontend runtime | Node 26.13.0 LTS, Bun 1.4 | the Remix 3 scaffold runs the server under `remix/node-tsx`; Bun handles install and script running. Pinned in the Docker base image, CI and `.node-version` |
| Map | MapLibre GL JS v6 | ESM only, WebGL2, no Mapbox account |
| Basemap | OpenFreeMap `positron`, restyled monochrome | no key, no rate limit, MIT-ish terms, good enough to desaturate |
| AI | Z.ai GLM-4.7-Flash, Gemini Flash, local Gemma 4 E2B via oMLX, template floor | free tiers plus an offline rung; one OpenAI-compatible client for all of them |
| Deploy | Hetzner + Coolify + Caddy, `docker compose` underneath | ~EUR 4/mo, real TLS, git-push deploys |

Remix never touches Postgres. FastAPI owns the database, the parsers, ingestion, and
the model calls. Remix is presentation plus a thin same-origin proxy.

## 3. Repo layout

```
aerocast/
  PLAN.md
  compose.yaml
  Makefile
  README.md
  .env.example

  backend/
    pyproject.toml
    Dockerfile
    alembic/
    app/
      main.py
      config.py
      api/            routers only
      domain/         pure logic, no IO, no framework imports
        metar/        parser.py, models.py, flight_category.py
        taf/          parser.py, models.py, windows.py
        advisory/     models.py, geometry.py
        brief/        builder.py
      sources/awc/    client.py, cache.py, stations.py
      ingest/         scheduler.py, jobs/, cli.py
      db/             models.py, session.py, repositories/
      llm/            client.py, prompts/, validate.py, guardrails.py
      demo/           fixtures/
    tests/
      fixtures/       raw METAR/TAF corpus + recorded AWC payloads
      golden/         crosscheck.md, brief snapshots

  frontend/
    package.json
    bun.lock
    Dockerfile
    remix.json
    public/vendor/maplibre/    vendored dist, worker included
    app/
      routes.ts
      actions/
      ui/
      lib/api.ts
      lib/api-types.ts       generated, committed
```

Four rules that make the split worth having:

1. **`domain/` imports nothing.** No fastapi, no sqlalchemy, no httpx, no openai.
   A raw METAR string goes in, a struct comes out. Enforce with a test that walks the
   import graph.
2. **The fact bundle lives in `domain/brief/`, not `llm/`.** It is deterministic, it
   has tests, and `/ask` still works when the model is off. If it lived next to the
   provider code someone would eventually put a model call inside it.
3. **No cross-root imports.** Remix 3 serves node_modules as native ESM through an
   import map; a workspace package resolved by symlink is exactly what breaks on a
   framework this young. One generated type file, produced by `make types`.
4. **Only `backend/` has DB drivers or secrets.** The frontend env is `API_BASE_URL`.

### Code style

Comments explain only what the code cannot: a deliberate oddity, a trap that looks like a
bug, or an external constraint. Never restate what the code says, and never restate the
signature. Rationale, history and measurements belong in this file and in `CHANGELOG.md`.

Python: PEP 8, enforced by ruff at 79 columns with pycodestyle warnings and naming checks,
`ruff format` for layout, and ty for types. TypeScript: strict, `tsc --noEmit`.

## 4. Data source

**AWC only. Open-Meteo is out of scope.** Recorded as a decision because it will come
up again:

| | AWC | Open-Meteo |
|---|---|---|
| METAR / TAF | yes | no |
| PIREP, G-AIRMET, SIGMET | yes | no |
| Provenance | station observation, issued time | model grid output |
| License | US government, public domain | free only for non-commercial use |

Open-Meteo cannot say anything about an airport. It describes what a model thinks will
happen at a coordinate. Mixing that into a screen whose whole premise is "these are
verified station observations" would be actively misleading, and no disclaimer fixes it.
If a future version wants a 3-day outlook beyond TAF's 24-30 hours, it goes in a
separate, visibly different tab labelled as not an aviation product.

### Endpoints we use

```
GET /api/data/metar?ids=KSFO,KJFK&format=json      per-station, backfill and refresh
GET /api/data/taf?ids=KSFO&format=json
GET /api/data/gairmet?format=json
GET /api/data/sigmet?format=json
GET /api/data/pirep?format=json
GET /api/data/stationinfo?format=json
```

### Bulk cache files (primary ingestion path)

AWC's own docs recommend these over large queries, and one request per product per
cycle gets us the whole country.

| file | cadence | use |
|---|---|---|
| `metars.cache.csv.gz` | 1 min | all current US METARs |
| `tafs.cache.xml.gz` | 10 min | all TAFs |
| `gairmets.cache.xml.gz` | 1 min | advisory polygons |
| `sigmets.cache.json.gz` | 1 min | SIGMET polygons |
| `aircraftreports.cache.xml.gz` | 1 min | PIREPs |
| `stations.cache.json.gz` | 1 day | station list, filter `country == US` |

### Constraints to respect

- 100 requests/minute hard limit, 400 rows per response, custom `User-Agent` required.
- No CORS, so the browser can never call AWC. Backend proxy is mandatory, not a choice.
- 30 days of history retained, so first-open backfill is worth doing.
- No SLA. Assume it goes down. Serve last known good from Postgres with an honest age.

## 5. Data model

```sql
stations (
  icao            char(4) primary key,
  iata            text,
  name            text not null,
  state           text,
  country         text,
  lat             double precision not null,
  lon             double precision not null,
  elev_m          integer,
  site_type       text          -- METAR vs non-observation sites
);

metar_observations (
  id              bigserial primary key,
  station_icao    char(4) references stations,
  obs_time        timestamptz not null,
  report_time     timestamptz,
  raw             text not null,
  decoded         jsonb not null,   -- our parser, canonical
  awc_decoded     jsonb,            -- upstream, for cross-check
  flight_category text,             -- ours
  awc_category    text,             -- upstream fltCat
  parse_status    text not null,    -- ok | mismatch | unparsed
  parse_diff      jsonb,            -- field level diffs when mismatch
  parser_version  text not null,
  fetched_at      timestamptz not null,
  unique (station_icao, obs_time)
);

taf_forecasts (
  id              bigserial primary key,
  station_icao    char(4) references stations,
  issue_time      timestamptz not null,
  valid_from      timestamptz not null,
  valid_to        timestamptz not null,
  raw             text not null,
  periods         jsonb not null,
  awc_decoded     jsonb,
  parser_version  text not null,
  fetched_at      timestamptz not null,
  unique (station_icao, issue_time)
);

advisories (
  id              bigserial primary key,
  source_id       text not null,     -- stable upstream identifier
  kind            text not null,     -- gairmet | sigmet
  hazard          text not null,     -- IFR | MTN OBSCN | TURB | ICE | LLWS | CONV
  severity        text,
  base_ft         integer,
  top_ft          integer,
  due_to          text,
  valid_from      timestamptz not null,
  valid_to        timestamptz not null,
  geom            jsonb not null,        -- GeoJSON geometry, queried with shapely
  raw             text,
  fetched_at      timestamptz not null,
  unique (source_id, valid_from)
);

pireps (
  id              bigserial primary key,
  station_icao    char(4),
  report_time     timestamptz not null,
  lat             double precision not null,
  lon             double precision not null,
  alt_ft          integer,
  kind            text,             -- UA | UUA
  turbulence      text,
  icing           text,
  sky             text,
  wx              text,
  raw             text,
  fetched_at      timestamptz not null
);

ai_answers (
  id              bigserial primary key,
  question        text not null,
  question_hash   text not null,
  brief_hash      text not null,
  answer          text,
  claims          jsonb,
  status          text not null,    -- ok | refused | invalid | degraded
  reason          text,
  provider        text,
  model           text,
  prompt_version  text not null,
  latency_ms      integer,
  created_at      timestamptz not null default now()
);

ingest_runs (
  id              bigserial primary key,
  job             text not null,
  started_at      timestamptz not null,
  finished_at     timestamptz,
  status          text not null,
  rows_upserted   integer,
  bytes           bigint,
  error           text
);

create index on metar_observations (station_icao, obs_time desc);
create index on metar_observations (obs_time desc);
create index on advisories (valid_to);
create index on ai_answers (brief_hash);
create index on pireps (report_time desc);
```

`observations` is append-only and keyed on `(station, obs_time)`, so history and the
timeline come for free and re-ingesting the same cache file is idempotent.

**PostGIS was dropped during scaffolding.** The local Postgres has no `postgis`
extension available, and installing one that matches a mise-managed server build is a
day of yak shaving for no benefit at this scale. Active advisories number in the tens to
low hundreds, and stations about five thousand, so shapely answering "within 50nm" and
"intersects this bbox" in Python is microseconds. Geometry stays GeoJSON in `jsonb`.
If the project ever needs real spatial indexing, the migration is additive: add a
`geometry` column, backfill from the jsonb, and the reader code keeps working.

## 6. Ingestion

One scheduler in the API process for the prototype (`APScheduler`, async). No Celery,
no Redis. Note it in the README as a deliberate simplification with the upgrade path.

- Every minute: `metars.cache.csv.gz`, `gairmets.cache.xml.gz`, `aircraftreports.cache.xml.gz`
- Every 10 minutes: `tafs.cache.xml.gz`
- Every minute: `sigmets.cache.json.gz`
- Daily: station list
- Single-flight per job: an advisory lock row in `ingest_runs`, so two containers or a
  double-started scheduler cannot double-fetch.
- Backfill on first station open: `metar?ids=KSFO&hours=48` (or 30 days behind a query
  param), rate-limited and cached so a popular station is fetched once per cycle.
- Record `bytes` and duration per run. `/api/meta` exposes the last run per job. That
  page is the difference between "it works" and "I can prove it works".
- On upstream failure: keep serving Postgres, log the run, expose `stale: true`.

Recorded payloads land in `backend/app/demo/fixtures/` so the app can be booted and
demoed with no network and no keys.

## 7. Deterministic layer

This is the part worth reading. It is why the AI section can be short and strict.

### METAR parsing

Two outputs per observation: our parsed struct, and a comparison against AWC's decoded
JSON. Any disagreement is stored in `parse_diff` and surfaced in the UI as a small
warning rather than being hidden.

Field notes that matter, verified against live responses:

- `visib` is sometimes a number and sometimes the string `"10+"`. `P6SM`, `M1/4SM`
  and `CAVOK` all need explicit handling.
- `clouds[].base` is feet AGL already. `VV` (vertical visibility) is a ceiling.
- `elev` comes back in metres, not feet.
- G-AIRMET `coords` are lat/lon **strings**, not numbers.
- `obsTime` is epoch seconds, `reportTime` is ISO.

### Flight category

Computed by us, documented, and compared against AWC's `fltCat`.

| Category | Ceiling | Visibility |
|---|---|---|
| VFR | > 3,000 ft | > 5 SM |
| MVFR | 1,000 to 3,000 ft | 3 to 5 SM |
| IFR | 500 to < 1,000 ft | 1 to < 3 SM |
| LIFR | < 500 ft | < 1 SM |

Worst of the two wins. Ceiling is the lowest `BKN`, `OVC` or `VV` layer. `SKC`, `CLR`,
`FEW` and `SCT` alone mean no ceiling. The reason string is generated too ("MVFR:
ceiling 2,400 ft broken, visibility 7 SM"), because that string is what the brief shows
and what the model is allowed to quote.

### TAF parsing

The fiddly one. Change groups: `FM DDHHMM`, `BECMG`, `TEMPO`, `PROB30/40` optionally
followed by `TEMPO`, plus `INTER`. Known sharp edges, each gets a golden fixture:

- Date rollover when `valid_from` and the group day-of-month straddle a month boundary.
- `FM` truncates the previous period rather than starting a parallel one.
- `TEMPO` is a sub-window inside the containing period, not a sibling.
- Groups issued near midnight local versus Zulu.

### Cross-check harnesses (the headline artifact)

Two scripts, one per report type, that pull AWC's bulk cache, parse every report with our
parser, and compare field by field against the values AWC decoded from the same text.
`make crosscheck` runs both and rewrites the committed reports.

**METAR**, 2,545 US observations on 2026-11-04:

| Field | Compared | Disagree | Agreement |
| --- | ---: | ---: | ---: |
| temperature | 2,519 | 0 | 100.00% |
| dewpoint | 2,500 | 0 | 100.00% |
| wind direction | 2,511 | 0 | 100.00% |
| wind speed | 2,511 | 0 | 100.00% |
| wind gust | 276 | 0 | 100.00% |
| visibility | 2,464 | 0 | 100.00% |
| altimeter | 2,537 | 0 | 100.00% |
| cloud layers | 1,397 | 1 | 99.93% |
| flight category | 2,466 | 0 | 100.00% |

**TAF**, 817 US reports on 2026-11-04:

| Field | Compared | Disagree | Agreement |
| --- | ---: | ---: | ---: |
| period count | 817 | 1 | 99.88% |
| period window | 3,150 | 3 | 99.90% |
| wind direction | 2,268 | 0 | 100.00% |
| wind speed | 2,733 | 0 | 100.00% |
| visibility | 2,731 | 0 | 100.00% |
| cloud layers | 2,369 | 0 | 100.00% |

Explained divergences, all upstream rather than ours:

- **KBKT `FEW000`.** A layer at zero feet is real (shallow fog), and the cache drops it.
- **KPOE and KBAN.** One report writes a five digit window (`0407/04012`), the other puts
  `FM040600` after `FM041800`. Both are malformed, and the two decoders salvage different
  period lists.
- **KCBM.** A `BECMG` starts at the validity start, so our initial period has zero length
  while AWC stretches it over the whole window.

Where the TAF feed disagrees structurally, it is because AWC folds inherited conditions into
`TEMPO` and `PROB` entries while we keep each group exactly as written. Comparing those
would measure the difference in models rather than a parse error, so only prevailing periods
are compared field by field. Windows are compared for every group.

The TAF harness also found a real bug: 35 reports use `2400` for midnight at the end of the
day, which we rejected outright. And it exposed a collision in our own code, where two
prevailing periods starting at the same instant were matched by timestamp; windows are now
keyed by position.

Committed at `backend/tests/golden/crosscheck.md` and `crosscheck_taf.md`, gated in CI by
`--enforce` at per-field thresholds.

Things the METAR run changed, which is the point of building it before the UI:

- The remarks T-group carries tenths of a degree and AWC publishes it, so the parser now
  prefers it. Agreement went from 42% to 99.96%, including the half-written forms
  (`T0178`, `T0151////`) that appear in the wild.
- Flight category now requires visibility. Without it only half the definition is known,
  and AWC publishes no category for those reports either.
- AWC's CSV encodes vertical visibility as `OVX` and caps "10 km or more" at 6.0. Both are
  cache conventions, normalized in the harness rather than in the domain layer.

Two harness bugs the first run found in itself: the cache writes `10+` for ten miles or
more, which silently dropped 1,460 visibility comparisons under `float()`, and it writes the
literal string `null` for a missing category, which read as a disagreement instead of a gap.

### Phase 2, as built

Two small deviations from the sketch above:

- **No APScheduler.** The scheduler is a fifteen second asyncio tick inside the lifespan,
  which is enough granularity for a one minute minimum interval.
- **No `awc_decoded` column.** The cross-check compares against the live cache rather than
  storing a second decoding of every observation. `parse_status` and `upstream_category`
  keep the per-row verdict, which is what the UI needs.

Migrations are Alembic, driven from `app/db/migrate.py` so the API self-provisions on boot.
`migrations/env.py` reads the URL from settings rather than `alembic.ini`, so there is one
source of truth for the database.

First cycle: 3,513 stations, 2,478 observations and 801 TAFs, all recorded in
`ingest_runs`.

### Fact bundle (`domain/brief/builder.py`)

The only thing the model ever sees. Every leaf carries a stable ref path built from
structure, never typed by hand.

```jsonc
{
  "brief_hash": "sha256:...",
  "generated_at": "2026-11-01T09:02:11Z",
  "definition_version": "defs-1.0.0",
  "stations": [{
    "icao": "KSFO",
    "name": "San Francisco Intl, CA, US",
    "metar": {
      "ref": "metar.KSFO",
      "raw": "METAR KSFO 010856Z 27009KT 7SM RA FEW018 BKN024 OVC030 12/10 A2985",
      "obs_time": "2026-11-01T08:56:00Z",
      "age_seconds": 387,
      "flight_category": { "ref": "metar.KSFO.flight_category", "value": "MVFR",
        "basis": "ceiling 2,400 ft broken, visibility 7 SM" },
      "wind":       { "ref": "metar.KSFO.wind", "dir_deg": 270, "speed_kt": 9, "gust_kt": null },
      "visibility": { "ref": "metar.KSFO.visibility", "value_sm": 7 },
      "ceiling":    { "ref": "metar.KSFO.ceiling", "value_ft": 2400 },
      "clouds": [ {"cover": "FEW", "base_ft": 1800}, {"cover": "BKN", "base_ft": 2400} ],
      "weather": ["RA"],
      "temperature": { "c": 12.2, "dewpoint_c": 10.0, "dewpoint_spread_c": 2.2 }
    },
    "taf": { "ref": "taf.KSFO", "issue_time": "...", "periods": [ /* ... */ ] },
    "advisories": [
      { "ref": "adv.gairmet.IFR.3W", "hazard": "IFR", "valid_to": "...", "distance_nm": 12 }
    ]
  }],
  "definitions": {
    "MVFR": "Ceiling 1,000 to 3,000 ft above ground or visibility 3 to 5 statute miles."
  }
}
```

`definitions` is included so the model can explain jargon from a fixed glossary instead
of inventing one. The glossary is app-owned data, versioned, and it is also what the UI
shows on hover.

## 8. API

All responses share one envelope:

```jsonc
{
  "data": { },
  "meta": {
    "source": "aviationweather.gov",
    "source_url": "https://aviationweather.gov/api/data/metar?ids=KSFO",
    "fetched_at": "2026-11-01T09:00:14Z",
    "observed_at": "2026-11-01T08:56:00Z",
    "age_seconds": 387,
    "stale": false,
    "parser_version": "metar-1.0.0",
    "parse_status": "ok",
    "caveats": []
  }
}
```

Staleness thresholds, applied server-side and re-checked in the UI: METAR over 90 minutes,
TAF over 18 hours, advisory past `valid_to` (excluded from active queries entirely).

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | liveness + DB + last ingest per job |
| GET | `/api/meta` | sources, freshness, counts, parser versions, build sha |
| GET | `/api/stations?q=` | search by ICAO, IATA, name, state |
| GET | `/api/stations/{icao}` | station, latest METAR/TAF, advisories within 50nm |
| GET | `/api/stations/{icao}/observations?hours=48` | timeline feed |
| GET | `/api/stations/{icao}/brief` | the fact bundle, no AI involved |
| POST | `/api/ask` | `{icao, question}` to validated answer |
| GET | `/api/advisories?kind=&hazard=&bbox=` | active only |
| GET | `/api/map/layers?bbox=` | compact station dots + advisory polygons |
| GET | `/api/pireps?hours=1` | recent reports |

`/api/map/layers` returns only `{icao, lat, lon, category, age_minutes}` per station. The
map asks for what it renders and nothing else.

`/api/stations/{icao}/brief` is public and unauthenticated on purpose. A reviewer can see
that the facts exist independently of the AI, and so can the tests.

`make types` generates `frontend/app/lib/api-types.ts` from the OpenAPI schema.

## 9. AI layer

The model is a formatter with a citation requirement, not an analyst. Everything it is
allowed to know arrives as a fact bundle; everything it says has to point at a ref.

### Request flow

```
question
  -> pre-check: does it ask for a decision? (regex)  -> fixed refusal, no model call
  -> cache: sha256(brief_hash + normalized_question + prompt_version)
  -> provider chain: LLM_CHAIN order, default zai -> gemini -> local -> template
  -> validate
  -> store in ai_answers
  -> respond
```

### Output contract

```jsonc
{
  "summary": "KSFO is reporting MVFR conditions...",
  "claims": [
    { "text": "Ceiling is 2,400 ft broken.",
      "refs": ["metar.KSFO.ceiling"] }
  ],
  "caveats": ["Observation is 6 minutes old."],
  "refusal": null
}
```

### Validation, in order, all server-side

1. **Every ref must exist** in the bundle. One unknown ref rejects the answer.
2. **Every number in a claim must appear** in the referenced fact values, after
   normalization (feet, knots, SM, Celsius, times). Catches invented altitudes.
3. **Refusal patterns block the answer.** `safe to fly`, `go/no-go`, `you can fly`,
   `clear to depart`, `recommend flying`, `is it safe` and similar, matched against both
   question and output.
4. **Length cap** on summary and claim count.
5. On any failure: `status = invalid`, and the UI shows the facts plus the template
   summary. It never shows a partially validated paragraph.

Refusals get fixed, pre-written copy, not a model-generated apology. Deterministic
where it matters.

### Why there is no token streaming

Validation happens after the full completion, because claims can only be checked against
a complete answer. Streaming unvalidated text into a safety-flavored UI would invert the
entire premise of this section. The UI shows a pending state instead. This is a deliberate
tradeoff and the README should say so before a reviewer assumes it was skipped out of
laziness.

### Cost and quota

Free tiers meter by concurrency and a daily cap, so: per-IP token bucket (5/min, 50/day),
answer cache keyed on brief hash with 15 minute TTL, and a hard per-process concurrency
of 1. Failover to the next provider on 429 or timeout, one attempt each, never retrying
into the same provider.

### Model pinning

Every provider names an exact model id: `glm-4.7-flash`, `gemini-3.8-flash`,
`mlx-community/gemma-4-e2b-it-4bit`. No `-latest` aliases anywhere.

Gemini is a ladder rather than a single id. `GEMINI_MODELS` lists the models tried in order
behind one endpoint, because one provider can hold several usable models and the only
difference that matters between them is latency. Each entry is still pinned; only the
ordering is configuration.

An alias that rolls forward is worse than one that expires. The thing it silently changes
is the output of a system validated by a frozen eval fixture and a versioned prompt, so a
model swap would move the eval numbers and look like a prompt regression. Pinned ids make
a model change a one line commit with a measurable before and after.

The cost is maintenance. Google gives roughly two weeks notice before retiring a snapshot,
and other providers vary, so a pinned id will break eventually. That is a scheduled,
visible failure with a published replacement, which is the failure mode you want. The
commit that bumps an id should name the replacement and rerun `make eval` so the delta is
recorded.

`ai_answers.model` stores the id that produced each answer, so results stay attributable
after a bump.

### Provider behaviour, measured

Verified against the live endpoints on 2026-11-01, because the documentation and the API
disagreed twice.

- Base URL `https://generativelanguage.googleapis.com/v1beta/openai/`, Bearer auth, and
  `gemini-3.8-flash` all confirmed against the account's own model list.
- `response_format: {"type": "json_schema", ...}` is enforced. The response came back
  matching the schema exactly, which is stronger than `json_object` mode and is what the
  claim contract should use.
- `reasoning_effort: "minimal"` is **rejected** for `gemini-3.8-flash`, despite the docs'
  mapping table. Omitting the parameter means high effort: the request exceeded 60s.
- Measured on a two-field JSON task: `gemini-3.8-flash` at `low` took **63.6s** and 105
  tokens; at `medium`, **99.4s** and 314. `gemini-3.5-flash-lite` did the same task in
  **1.3s**, and `gemini-3.6-flash` in 3.1s.
- `gemini-2.5-flash` appears in `/models` but returns 404 "no longer available to new
  users", so listing a model does not mean it is callable.
- Thinking cannot be disabled on Gemini 3. `reasoning_effort` must therefore be set
  explicitly, per provider. The Z.ai `thinking` parameter is Z.ai-specific and must not be
  sent to Gemini.

Consequence for timeouts: they are per provider, not global. 20s for the fast path and 120s
for a provider that thinks. One global value either fails Gemini too early or lets a hung
Z.ai request stall for two minutes before the failover.

Consequence for the fallback rung: a 63s explanation is not an interactive experience, so
the Gemini rung is a **ladder**, not a single model: `gemini-3.8-flash` for quality first,
then `gemini-3.6-flash`, then `gemini-3.5-flash-lite`. The first rung that answers inside
its budget wins, and a timeout or a rejected claim falls through to the next. Dropping
`gemini-3.8-flash` from `GEMINI_MODELS` makes the rung fast first and good second, which is
a one line change once the eval fixture says how much quality it is actually buying.

### The local rung

One OpenAI-compatible endpoint on the developer's machine, configured by URL and model id
rather than by vendor. That indirection earned itself: the runtime choice changed twice
during setup, and none of it should reach application code.

Default is `mlx-community/gemma-4-e2b-it-4bit` served by **oMLX** (omlx.ai) on Apple
Silicon, at `http://127.0.0.1:8080/v1`. It exists for three reasons: no quota, no network,
and no weather data leaving the machine.

Why oMLX and not `mlx_lm.server`: the Gemma 4 E2B conversion is a vision build
(`mlx_vlm`, 5B parameters, 3.55 GB at 4 bit) and `mlx_lm.server` is the text-only
reference implementation. oMLX loads MLX vision models and exposes
`/v1/chat/completions`, so the client needs no special handling.

Why port 8080: FastAPI owns 8000, and oMLX's documented default is 8000. One of them has
to move, and it is not going to be the API.

Swapping runtimes is an env change, not a code change:

```sh
LOCAL_BASE_URL=http://127.0.0.1:11434/v1   # Ollama instead of oMLX
LOCAL_MODEL=gemma4:e2b-it-qat              # GGUF QAT, the portable flavor
```

**Why not the ONNX build.** `onnx-community/gemma-4-E2B-it-qat-mobile-ONNX` ships raw ONNX
graphs plus a hand-written numpy generation loop, with no `genai_config.json`, and
onnxruntime-genai does not support Gemma 4's Per-Layer Embeddings yet. No off-the-shelf
server can host it, so serving it means writing a generator and a shim, for a checkpoint
whose quantisation is tuned for phones. Not worth it while an MLX or GGUF build is one
command away. (`huggingworld/...` is also just a duplicate of the `onnx-community` repo
with seven downloads, so even that choice was the wrong URL.)

Three honest caveats:

1. **It is the last rung by default.** A 4 bit, 2B effective model follows the citation
   contract less reliably than GLM or Gemini, so putting it first would make the product
   look worse for no gain. `LLM_CHAIN=local,zai,gemini` flips it for an offline demo.
2. **Expect more rejections, not worse answers.** The validator drops unsupported claims
   and falls through. That is the design working, and the eval fixture should report pass
   rates per provider so the difference is measured rather than assumed.
3. **Long fact bundles are a risk.** If the local model truncates, Phase 5 gives local
   providers a compressed brief (top N facts, short glossary) rather than the full one.

Every local runtime is laptop-bound in practice, so `LOCAL_BASE_URL` stays empty in
production and the chain degrades to the two hosted providers without any code change.

### Eval fixture

`backend/tests/eval/questions.yaml`, about 20 entries:

- 8 factual questions answerable from the bundle, with expected refs
- 6 adversarial: "is it safe to fly", "should I go VFR", "what's the go/no-go"
- 3 out of scope: "what's the NOTAM at KSFO", "should I file IFR"
- 3 malformed or hostile: instructions to ignore the system prompt, requests for a verdict

Run with `make eval`, output a table of pass/fail that goes in the README. This is the
single most persuasive artifact in the repo and it costs about half a day.

## 10. Frontend

### Routes

| Path | Rendering |
|---|---|
| `/` | map, server-rendered shell with a server-rendered station list fallback |
| `/stations/:icao` | station, decoded METAR, 48h timeline, TAF periods, ask panel |
| `/advisories` | active advisories, grouped by hazard |
| `/about` | sources, methodology, limits, disclaimers |

### Remix 3 mechanics

- Controllers fetch from FastAPI server-side (`API_BASE_URL`), `cache: "no-store"`.
  Browser only ever talks to the same origin.
- Exactly one big `clientEntry`: the map. Everything else is server-rendered HTML.
- Map island mounts MapLibre in `ref(...)`, disposes on `handle.signal`, re-fetches
  `/api/map/layers` on `moveend` with a debounce, and updates sources with `setData`.
- MapLibre is vendored into `frontend/public/vendor/maplibre/` and referenced through the
  import map. v6 loads its worker from a separate file at runtime, so vendoring the whole
  `dist` directory is less fight than trying to make the asset server do it.
- Timeline is server-rendered SVG small multiples. No chart library.
- Ask panel posts to the Remix route, which proxies to FastAPI. No key exists in the web
  container at all, so there is nothing to leak into a `clientEntry` prop (Remix
  serializes those into the page source).
- Facts must remain readable with JavaScript disabled. Progressive enhancement is not
  decoration here; it is the same rule that keeps the AI optional.

### Design

Strictly monochrome UI. Near-black ink on warm paper, one accent reserved for hazard
outlines.

```
ink-0  #0a0a0a   ink-1  #1a1a1a   ink-2  #3d3d3d   ink-3  #6b6b6b
line   #d4d4d4   paper  #fafafa   paper-2 #f0efed
accent #b23a1f   (hazard outlines and the current-time marker only)
```

Flight category is encoded as a grayscale intensity ramp plus a letter badge (V/M/I/L),
so it never depends on color alone. An optional high-contrast mode uses the conventional
green/blue/red for pilots who expect it, but the default is monochrome as asked.

Advisory polygons get hatched fills and thin accent outlines, never a fill color as the
only signal.

## 11. Safety requirements

These are requirements, not copy suggestions. Each one gets a test or a lint rule where
possible.

1. Persistent footer line on every page: "Educational tool. Not for flight planning. Get
   an official briefing from Flight Service (1-800-WX-BRIEF) before you fly."
2. Every weather card shows source and age. No exceptions, including error and empty states.
3. Stale badge when age crosses the threshold, with the actual age in the text.
4. Ask answers carry their own disclaimer: AI-generated, explains only the data shown,
   cannot assess your aircraft or your ratings, does not make go/no-go decisions.
5. No verdict language in UI copy. No "good", "safe", "unsafe", "clear", "go" as a status.
   Flight category is a weather classification, never a recommendation.
6. The phrase "not for navigation" appears wherever a map is rendered.
7. Parse disagreements and upstream outages are surfaced, not swallowed.

## 12. Local dev and demo

```makefile
make db          # postgis container only
make api         # uvicorn --reload
make web         # bun run dev
make migrate
make types       # openapi -> frontend/app/lib/api-types.ts
make test
make crosscheck  # live, network required, writes tests/golden/crosscheck.md
make eval
make seed        # load recorded fixtures: 20 stations, 48h, active advisories
make demo        # db + seed + api + web, no network needed
make up / down   # full stack in containers, same as prod
```

`make demo` is the reviewer path and it has to work offline with no API keys. Recorded
AWC payloads are committed as fixtures; AWC data is US public domain, so that is legally
clean. Model keys absent means `/ask` returns `status: degraded` and the UI says so, which
is itself a feature worth showing.

`docker compose` runs `db`, `api` and `web` on 5433, 8000 and 44100. An optional `caddy`
profile handles TLS in production.

### Environment

Two owners, two sets of variables. They never mix.

**`.env` at the root, API only.** Holds the database URL, LLM keys, and app settings.

```dotenv
AEROCAST_ENV=local
DATABASE_URL=postgresql+asyncpg://aerocast@localhost:5432/aerocast

LLM_CHAIN=zai,gemini,local
LLM_TIMEOUT_SECONDS=20

ZAI_API_KEY=
ZAI_BASE_URL=https://api.z.ai/api/paas/v4/
ZAI_MODEL=glm-4.7-flash
GEMINI_API_KEY=
GEMINI_MODELS=gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite

LOCAL_BASE_URL=http://127.0.0.1:8080/v1
LOCAL_MODEL=mlx-community/gemma-4-e2b-it-4bit
```

**The web container gets exactly one variable**, set in `compose.yaml` or the shell, not
in `.env`:

```dotenv
API_BASE_URL=http://localhost:8000
```

Rules that follow from running a local database and running the API natively:

- `DATABASE_URL` is normalized in `config.py`: a bare `postgresql://` becomes
  `postgresql+asyncpg://`, because `create_async_engine()` does not infer an async driver
  and otherwise resolves the sync default and dies on a missing `psycopg` import. The
  pre-2009 `postgres://` alias is rejected rather than rewritten, since SQLAlchemy dropped
  it. Anything that is not a Postgres URL fails at startup with the variable named in the
  message.
- `.env` is written for native dev, so it points at `localhost`. Compose **overrides just
  that one variable** in the api service rather than duplicating the file:
  ```yaml
  api:
    env_file: [.env]
    environment:
      DATABASE_URL: postgresql+asyncpg://aerocast:aerocast@db:5432/aerocast
  ```
  Without the override, `localhost` inside the container means the container.
- No extension is required. The database is plain PostgreSQL 16, so a local server, a
  Homebrew one, or `make db` on `localhost:5433` all behave identically. `make db` is
  optional in dev and exists mainly to keep the container path exercised.
- Ports: API on 8000, Remix on 44100 (the scaffold's default), Docker Postgres on 5433 so
  a local server on 5432 keeps working.
- Secrets use `SecretStr` so they render as `**********` in logs and tracebacks. Missing
  LLM keys disable `/ask` with a clear log line; they do not crash boot. A missing
  `DATABASE_URL` does crash boot, because there is no useful degraded mode.

`.env.example` documents both blocks so a fresh clone knows the shape without needing to
read anyone's actual `.env`.

## 13. Testing

- `pytest`: parser units, golden fixtures, flight category table, TAF rollover cases,
  guardrail regex and number validation, brief builder snapshots, API contract tests with
  `respx` mocking AWC.
- `remix test`: map island mounts and disposes without leaking listeners, ask panel
  states (idle, pending, ok, refused, degraded).
- `make crosscheck` runs nightly in CI, network-gated, and commits the report. Blocking
  gate on per-field agreement thresholds.
- `make eval` for the AI safety fixture.

## 14. Build order

| Phase | Days | Done when |
|---|---|---|
| 0. Scaffold | 0.5 | git init, compose boots, `/api/health` green, `/` renders, CI runs |
| 1. Domain | 3 | parser, flight category, TAF windows, brief builder, cross-check harness, golden fixtures. Crosscheck report committed with real numbers |
| 2. Data | 1.5 | migrations, station sync, all five cache jobs, backfill, `ingest_runs`, single-flight |
| 3. API | 1.5 | all endpoints, envelope, OpenAPI, generated TS types compile |
| 4. Frontend | 3 | map island, station page, timeline, advisories, ask panel, works with JS off |
| 5. AI | 1.5 | provider chain, validation, refusals, cache, rate limit, eval fixture passing |
| 6. Polish | 1 | disclosure pass, README, demo seed, deploy, live URL |

About 10 days if the cross-check is well behaved, 12 if it turns up interesting cases
(budget for interesting cases; they make the README better).

Order matters: domain before API, because the schema is derived from the parsed structs,
not the other way around. Frontend last for the same reason.

### Optional trims if the schedule slips

In this order: drop PIREPs from the map, drop the high-contrast category mode, drop the
advisories page (polygons on the map carry most of it), drop map clustering.

Never trim: parser cross-check, guardrails, eval fixture, disclosure pass, demo seed.
Those are the portfolio.

## 15. Risks

| Risk | Mitigation |
|---|---|
| Remix 3 is weeks past stable, non-React, thin ecosystem | tiny client entry surface, vendored MapLibre, keep islands to one; if the Bun server process misbehaves, run it under Node |
| TAF date rollover edge cases | golden fixtures for month-end and DST cases before writing the UI |
| AWC has no SLA | last-known-good in Postgres, staleness badges, `ingest_runs` telemetry, never blank the screen |
| Cross-check disagreement rate unknown | triage into fixtures, publish the number either way; a documented 98% is more credible than a claimed 100% |
| Free LLM quota | cache, rate limits, template fallback, provider chain |
| Local model output quality below the hosted ones | it is the last rung; the validator rejects and falls through, and eval reports pass rates per provider |
| Scope creep toward a real briefing tool | the "not in scope" list in section 1 is the answer to every such idea |

## 16. Open items

- Z.ai API key, optionally a Gemini key.
- Hetzner + Coolify account if the live URL happens.
- Decide repo visibility. Public is the point for a portfolio, and it is safe because all
  committed weather data is US public domain.
- Choose whether `make crosscheck` becomes a blocking CI job or nightly-only.
