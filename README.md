# AeroCast AI

Aviation weather you can read, with every AI sentence tied to the observation it came from.

A read-only companion to an official briefing: METAR and TAF decoded, 48 hours of history,
active advisory polygons, and a plain-English explanation layer that is only allowed to
describe facts the deterministic parser verified.

**Educational tool. Not for flight planning. Obtain an official briefing from Flight
Service (1-800-WX-BRIEF) before you fly.** AeroCast does not make go/no-go decisions and
cannot assess your aircraft, currency, or ratings.

## Status

Phases 0 to 4 are complete. The API serves stations, observations, advisories, PIREPs and
the fact bundle; the web app is a dark, glassy map workspace with an icon navbar, a search
popover, a station card anchored above the selected dot that carries the full station
detail, and an explanation drawer that slides in on ask. It also serves the station pages
with the 48 hour timeline, the advisory list and the about page.

Phase 5 is in progress: `POST /api/ask` builds the fact bundle, checks for verdict
requests, walks the provider chain, validates citations and falls back to a deterministic
template with a quiet notice. Answer caching, per-IP rate limits and stored answers are
still to come. See [PLAN.md](PLAN.md) for the build order and
[CHANGELOG.md](CHANGELOG.md) for what has landed so far.

## Stack

| | |
|---|---|
| API | FastAPI, Python 3.13, SQLAlchemy + asyncpg, PostgreSQL 16 |
| Web | Remix 3.1 on Node 26.13.0 LTS, Bun for packages and scripts |
| Map | MapLibre GL JS (Phase 4) |
| Weather data | aviationweather.gov (AWC Data API and bulk cache files) |
| Explanations | GLM-4.7/4.5-Flash, Gemini Flash, or a local model via any OpenAI-compatible server, behind a citation validator |

## Run it

```sh
cp .env.example .env      # set DATABASE_URL for your Postgres
make install
make api                  # http://localhost:8000/api/docs
make web                  # http://localhost:44100
```

If you would rather use the containerised database than a local one:

```sh
make db                   # Postgres on localhost:5433
```

For a fully offline explanation path (Apple Silicon only), serve the MLX model with
[oMLX](https://omlx.ai) on port 8080 and put it first in the chain:

```sh
# oMLX serving mlx-community/gemma-4-e2b-it-4bit on :8080
LLM_CHAIN=local make api
```

Any OpenAI-compatible local server works: point `LOCAL_BASE_URL` and `LOCAL_MODEL` at
Ollama, LM Studio, or whatever else you run.

Full stack in containers, which is what production looks like:

```sh
make up
```

## Layout

```
backend/    FastAPI. Owns the database, parsers, ingestion, and the model keys.
  app/domain/   pure logic, no IO: METAR, TAF, flight category, fact bundle
frontend/   Remix 3. Presentation plus a same-origin proxy to the API.
  app/actions/public/  the four browser islands: map, station card, search, drawer
  app/ui/public/  the session they share, icons and the fact labels they format
  public/vendor/maplibre/  pinned MapLibre build, worker and stylesheet
PLAN.md     Scope, schema, API surface, safety requirements, build order.
```

The split is deliberate: `app/domain/` has no framework imports, because the parsing is
the part that has to be right and the part that is worth reading.

The map needs network access for basemap tiles from OpenFreeMap. Everything else,
including the station list and every decoded fact, is server-rendered and works offline
against whatever is already in Postgres.

## Tests

```sh
make test    # pytest, then Remix's test runner
make lint    # ruff, ty, then tsc
make types   # regenerate frontend/app/lib/api-types.ts from the schema
```

Both parsers are checked against AWC's own decoder, which needs network:

```sh
make crosscheck   # writes backend/tests/golden/crosscheck*.md
```

## Commits

Conventional Commits, enforced by a hook:

```sh
make hooks   # installs commit-msg and pre-commit
```

`commit-msg` rejects a subject that is not `type(scope): summary` or a subject or
body line longer than 72 characters. `pre-commit` runs `make lint test`, which is
under a second here and needs no network or database.

```
feat(map): add advisory polygons
fix(metar): treat P6SM as greater than six miles
refactor(llm): make the local provider runtime-agnostic
```

Types: `feat fix chore docs refactor test build ci perf style`. Git-generated
`Merge` and `Revert` commits are exempt.

## Data and attribution

Weather data comes from the US National Weather Service Aviation Weather Center
(aviationweather.gov) and is US Government public domain. AeroCast caches it and shows the
observation time and fetch time with every value. When upstream is stale or unavailable
the UI says so rather than showing a blank panel.
