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
| Frontend runtime | Node 26, Bun 1.4 | the Remix 3 scaffold runs the server under `remix/node-tsx`; Bun handles install and script running |
| Map | MapLibre GL JS v6 | ESM only, WebGL2, no Mapbox account |
| Basemap | OpenFreeMap `positron`, restyled monochrome | no key, no rate limit, MIT-ish terms, good enough to desaturate |
| AI | Z.ai GLM-4.7-Flash primary, Gemini Flash fallback, template floor | free tiers; provider chain behind one OpenAI-compatible client |
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

### Cross-check harness (the headline artifact)

A script that pulls `metars.cache.csv.gz` (all current US observations, several thousand),
parses every `rawOb` with our parser, and compares field by field to AWC's own decoded
JSON. Produces a report:

```
field            agree    disagree   rate
temp              4912          6   99.88%
wdir              4908         10   99.80%
altim             4901         17   99.65%
clouds            4860         58   98.82%
flight_category   4907         11   99.78%
```

Committed at `backend/tests/golden/crosscheck.md`, refreshed weekly, gated in CI at a
threshold that fails a regression. Every disagreement gets triaged into a fixture if it
is representable at all, or documented as an upstream quirk if it isn't.

This is the difference between "I wrote a parser" and "here is my measured agreement
rate with the authoritative decoder, and here are the nine cases where we differ."

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
  -> provider chain: zai -> gemini -> template
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
of 1. Failover to the second provider on 429 or timeout, one attempt each, never retrying
into the same provider.

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

LLM_PRIMARY=zai
LLM_FALLBACK=gemini
ZAI_API_KEY=
ZAI_BASE_URL=https://api.z.ai/api/paas/v4/
ZAI_MODEL=glm-4.7-flash
GEMINI_API_KEY=
GEMINI_MODEL=gemini-flash-latest
```

**The web container gets exactly one variable**, set in `compose.yaml` or the shell, not
in `.env`:

```dotenv
API_BASE_URL=http://localhost:8000
```

Rules that follow from running a local database and running the API natively:

- `DATABASE_URL` is normalized in `config.py`: a bare `postgresql://` and a legacy
  `postgres://` both get rewritten to `postgresql+asyncpg://`, because SQLAlchemy's async
  engine needs the driver in the scheme and this is a five minute bug otherwise. Anything
  that is not a Postgres URL fails at startup with the variable name in the message.
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
| Scope creep toward a real briefing tool | the "not in scope" list in section 1 is the answer to every such idea |

## 16. Open items

- Z.ai API key, optionally a Gemini key.
- Hetzner + Coolify account if the live URL happens.
- Decide repo visibility. Public is the point for a portfolio, and it is safe because all
  committed weather data is US public domain.
- Choose whether `make crosscheck` becomes a blocking CI job or nightly-only.
