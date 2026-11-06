# Changelog

Notable changes to AeroCast AI. Format follows [Keep a Changelog](https://keepachangelog.com)
and versions follow SemVer, with the version staying in `0.x` while the product shape is
still moving.

The detailed record is `git log`, since every commit follows Conventional Commits. This file
is the readable summary: what was added, what changed, what was removed, and what was
measured. Dates are the day the change landed.

## [Unreleased] 0.1.0, 2026-11-01

Phase 0 (scaffolding), Phase 1 (deterministic domain layer), Phase 2 (ingestion) and
Phase 3 (read API) are complete.

### Added

**API**

- `GET /api/stations?q=`: search by ICAO or name.
- `GET /api/stations/{icao}`: the station, its latest METAR and TAF, and every active
  advisory within 50 nm with a distance.
- `GET /api/stations/{icao}/observations?hours=48`: the history feed, up to 30 days.
- `GET /api/stations/{icao}/brief`: the deterministic fact bundle, public and
  unauthenticated. Rebuilt from stored raw text per request, so values and refs always
  belong to the parser that answered.
- `GET /api/map/layers?bbox=`: station dots and advisory polygons for the viewport. A
  bay-area request went from 327 KB unbounded to 3.6 KB with the filter, which is why the
  parameter exists.
- `GET /api/advisories?kind=&hazard=` and `GET /api/pireps?hours=`.
- `app/api/envelope.py`: one `{data, meta}` shape carrying source, fetch and observation
  times, age, and a `stale` flag.
- `app/api/models.py`: a response model for every endpoint, so `/api/openapi.json` is a
  contract rather than a list of empty objects.
- `make types` writes `frontend/app/lib/api-types.ts`; CI fails when the committed file
  drifts from the schema. The status page reads its health type from the generated file.

**Ingestion**

- `app/sources/awc/`: cache fetching plus readers for the METAR CSV, the TAF XML and the
  station list. `app/tools/crosscheck_*` now use them, so the cross-check and the loader
  parse the same bytes with one implementation.
- `app/ingest/`: station, METAR and TAF jobs writing to Postgres, each under a
  `pg_try_advisory_lock` and recorded in `ingest_runs`. `make ingest` runs one cycle; the
  API lifespan runs them on a loop (stations daily, METAR every minute, TAF every ten).
- `advisories` and `pireps` tables (revision `0002`), loaded from the G-AIRMET, SIGMET and
  PIREP endpoints every five minutes. Polygon and line geometry is stored as GeoJSON.
- `GET /api/meta`: row counts, the last run per job with its timing and error, and the URL
  every product came from.
- `make backfill STATIONS="KSFO KSEA"` loads up to 30 days of observations for a station,
  in batches of five because the endpoint caps a response at 400 rows.
- `backend/migrations/`: Alembic revision `0001`, applied on startup by
  `app/db/migrate.py` so a fresh volume provisions itself. `make migrate` runs it by hand.

**Backend**

- FastAPI app with `/api/health`, `/api/docs`, `/api/openapi.json`, and a lifespan that
  logs database and provider status at boot.
- Settings layer reading the repo-root `.env`: `SecretStr` for every credential,
  `DATABASE_URL` gaining the `asyncpg` driver when the scheme omits it, ordered `LLM_CHAIN`,
  and aliases so `mlx` and `omlx` both resolve to the local provider.
- Lazy async SQLAlchemy engine, session factory, a `ping()` that returns only the exception
  class name, and engine disposal on shutdown.
- Provider inventory that describes each configured provider in chain order and probes the
  local endpoint with a 500 ms timeout and a 10 s cache.

**Domain**

- `domain/metar`: token-scanner parser (`metar-1.1.0`), frozen value objects, and FAA flight
  category rules that emit a human-readable basis string.
- `domain/taf`: change-group parser (`taf-1.0.0`) covering `FM`, `BECMG`, `TEMPO`,
  `PROB30/40`, and `INTER`, plus window resolution for month rollover.
- `domain/weather`: the shared token grammar and value objects, so METAR and TAF parse wind,
  visibility, clouds, weather and ceilings with one implementation.
- `domain/brief`: the deterministic fact bundle, with a stable `ref` path on every citable
  value, a glossary of definitions, and a hash over its own canonical JSON.
- `app/tools/crosscheck_metar.py` and `make crosscheck`: parses AWC's live cache with our
  parser and compares field by field against AWC's own decoder.
- `app/tools/crosscheck_taf.py`: the same check for TAF, matching periods on their time
  window because the cache does not preserve report order. Shared cache parsing lives in
  `app/tools/cache.py`.
- `shapely`, for the spatial work in Phase 2.
- `/health` as an alias for `/api/health`, since probes commonly use the bare path.

**Frontend**

- Remix 3.1 app on Node 26.13.0 LTS, with Bun for package management and script
  running.
- Server-rendered status page in monochrome tokens, showing API, database and explanation
  status, plus the flight-planning disclaimer.
- Same-origin API client with a 3 s timeout, `AbortSignal` combining, and explicit handling
  of the 503 health response.

**Tooling and infrastructure**

- `compose.yaml` (Postgres, API, web), `Makefile`, `.env.example`, backend and frontend
  Dockerfiles, and a GitHub Actions workflow.
- ruff, pytest, pytest-asyncio, and ty, wired into `make lint` and CI.
- `app/tools/openapi_types.py` behind `make types`. `openapi-typescript` cannot run under
  TypeScript 7, which dropped the compiler API it builds output with, so the schema walk
  is about a hundred lines of backend code covering the shapes this API emits.
- `scripts/commit-msg` plus `make hooks`: rejects non-Conventional-Commit subject lines and
  exempts git-generated `Merge` and `Revert`.
- 100 backend tests, including a guard that fails if anything under `domain/` imports a web
  framework, database driver, HTTP client, or model provider.

### Changed

- **Timestamps serialize as `...Z`** instead of `+00:00`, because Pydantic writes UTC
  datetimes that way. The envelope used `isoformat()`; one format across the API is worth
  the one-time churn, and both parse as ISO 8601.
- **TAF periods keep `from` and `to`** in the bundle. The response model aliases them back,
  since the field names would otherwise have become `starts_at` and `ends_at` and quietly
  changed the documented shape.
- **`DATABASE_URL` no longer accepts `postgres://`.** The pre-2009 alias is rejected instead
  of rewritten, since SQLAlchemy dropped it. Plain `postgresql://` still gains the
  `postgresql+asyncpg://` driver, which the async engine needs.
- **Node is pinned to 26.13.0**, the current LTS, in the Docker base image, CI, the
  `engines` field and `frontend/.node-version`. `node:26-slim` resolves to the same digest
  today and will move; the pinned tag will not.
- **The local rung is off by default.** `LLM_CHAIN` is `zai,gemini` and `LOCAL_BASE_URL` is
  empty, so a fresh clone never probes a local server. Set both to re-enable it.
- **`httpx` is a runtime dependency**, not a dev one. `providers.py` probes with it, so the
  production image could not import the app without it. Caught by `make up`.
- **Provider chain** is now an ordered list (`LLM_CHAIN`) instead of two fixed slots, so a
  third rung and offline ordering are configuration rather than code.
- **Local provider renamed** from `mlx` to `local`, configured by `LOCAL_BASE_URL` and
  `LOCAL_MODEL`. Any OpenAI-compatible server fits: oMLX, Ollama, LM Studio, llama.cpp.
- **Gemini model pinned** to `gemini-3.8-flash` instead of `gemini-flash-latest`, because an
  alias that rolls forward would move eval numbers under a frozen prompt version.
- **Flight category requires visibility.** With no visibility group only half the definition
  is known, so the category is `null` rather than a guess. This matches AWC.
- **Temperature prefers the remarks `T`-group**, which carries tenths, over the rounded body
  group. Also handles the half-written forms (`T0178`, `T0151////`) found in the wild.
- **Database drops PostGIS** in favour of GeoJSON in `jsonb` with shapely. The local server
  has no PostGIS extension, active advisories number in the hundreds, and the migration back
  is additive if spatial indexing is ever needed.
- **Ports:** API 8000, Remix 44100, container Postgres 5433 so a local server on 5432 keeps
  working.
- The Remix starter page was replaced with an AeroCast status page.

### Removed

- PostGIS as a hard dependency.
- `LLM_PRIMARY` and `LLM_FALLBACK` environment variables (superseded by `LLM_CHAIN`).
- The Remix starter UI: demo cards, Remix wordmark hero, and the `prompt-button.tsx` client
  entry.
- The `compare` screen, cut from MVP scope. It is the feature with the weakest case against
  the free official site.

### Rejected after investigation

- **`onnx-community/gemma-4-E2B-it-qat-mobile-ONNX` as the local model.** It ships raw ONNX
  graphs with no `genai_config.json`, onnxruntime-genai does not support Gemma 4's Per-Layer
  Embeddings, and no off-the-shelf server can host it. Serving it would mean writing a
  generation loop and a shim for a checkpoint tuned for phones. The `huggingworld/...` copy
  is also just a duplicate of the `onnx-community` repo.
- **Open-Meteo as a weather source.** It has no METAR, TAF, PIREP or advisories, and mixing
  model grids into a screen of verified station observations would be misleading.

### Measured provider behaviour

Checked against the live endpoints rather than the docs, which were wrong in two places:

- Gemini's OpenAI-compatible base URL, Bearer auth, and `gemini-3.8-flash` all confirmed.
  `response_format: {"type": "json_schema"}` is enforced and returns exactly the schema.
- `reasoning_effort: "minimal"` is rejected for `gemini-3.8-flash`; omitting it means high
  effort. On a two-field JSON task, `low` took 63.6s and `medium` 99.4s, while
  `gemini-3.5-flash-lite` took 1.3s and `gemini-3.6-flash` 3.1s.
- `gemini-2.5-flash` is listed by `/models` but returns 404 "no longer available to new
  users".
- Thinking cannot be disabled on Gemini 3, so timeouts are per provider: 20s for the fast
  path, 120s for a thinking model.

### Changed, Gemini ladder

The Gemini rung is an ordered list of models (`GEMINI_MODELS`) behind one endpoint instead
of a single id, because the measured difference between them is latency. Default order is
`gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`: quality first, then two
fast rungs. Chain de-duplication now keys on provider and model, so one provider can hold
several rungs without collapsing to one.

### Changed, readability

The backend now conforms to PEP 8: 79 column limit, `ruff format` for layout, and the
pycodestyle warning and naming rules enabled. `make lint` and CI fail on formatting.

The TAF period builder was split into prevailing-window computation and window selection,
so each step can be read without holding the whole algorithm. `CATEGORY_ORDER` and
`iter_station_briefs` were removed as unused, and the METAR future-timestamp tolerance is a
named constant instead of a bare hour.

Comments were cut back to gotchas only: a deliberate oddity, a trap that looks like a bug,
or an external constraint. The rationale that had accumulated in docstrings moved into
PLAN.md and this file, where it is actually readable. Recorded as a rule in PLAN.

### Fixed

- **Temperature agreement with AWC fell from 42% to 99.96%** once remarks `T`-groups were
  parsed. Dewpoint, winds, visibility, altimeter and cloud layers are at 100%.
- The cross-check harness was dropping **1,460 of 2,383 visibility comparisons** because the
  cache writes `10+` for ten miles or more and `float()` rejected it.
- The cache writes the literal string `null` for a missing flight category; it was being read
  as a value and counted as a disagreement.
- AWC encodes vertical visibility as `OVX` in the cache and caps "10 km or more" at 6.0 SM.
  Both normalized in the harness rather than in the domain layer.
- **TAF `2400` is accepted.** 35 US reports write `2400` for midnight at the end of the
  day; the parser rejected them outright. Found by the TAF cross-check.
- **TAF windows are keyed by position, not start time.** A `BECMG` at the validity start
  shares its timestamp with the initial period, so windows collided and one period came out
  zero length.
- `ty` reported 82 diagnostics from three causes: a deprecated `AsyncIterator` annotation on
  `lifespan`, an untyped `**overrides` in the test settings factory, and a `dict[str, object]`
  return type on the fact bundle that callers could not subscript.
- Frontend typecheck failure where `body` could be undefined inside a template literal.
- pytest could not import `app` (missing `pythonpath`) and had no async plugin configured.

### Known divergences from AWC

Two disagreements remain out of 2,383 observations, both adjudicated:

- `KC62` publishes `08/06` in the body and `T00910066` (+9.1) in the remarks. AWC publishes
  the body value. We take the sensor group.
- `KS24` reports `BKN070 OVC010` out of altitude order. AWC takes the first layer (7,000 ft)
  and publishes VFR. The FAA ceiling is the lowest broken or overcast layer, which is
  1,000 ft and MVFR. A test pins our behaviour so it cannot be "simplified" back.

### Commits

The commit log is the detailed record: `git log --oneline`. Every subject follows
Conventional Commits, so it reads as a summary on its own.

## Conventions

Change types come from Conventional Commits: `feat`, `fix`, `chore`, `docs`, `refactor`,
`test`, `build`, `ci`, `perf`, `style`. Scopes name a domain area (`metar`, `taf`, `llm`,
`brief`) rather than an app, since most work lands in one app.

New entries go under `[Unreleased]` in the matching heading. When a release is tagged, the
section is renamed to the version and a fresh `[Unreleased]` starts above it.
