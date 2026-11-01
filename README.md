# AeroCast AI

Aviation weather you can read, with every AI sentence tied to the observation it came from.

A read-only companion to an official briefing: METAR and TAF decoded, 48 hours of history,
active advisory polygons, and a plain-English explanation layer that is only allowed to
describe facts the deterministic parser verified.

**Educational tool. Not for flight planning. Obtain an official briefing from Flight
Service (1-800-WX-BRIEF) before you fly.** AeroCast does not make go/no-go decisions and
cannot assess your aircraft, currency, or ratings.

## Status

Phase 0 complete: both services run, the web app renders live API health, backend tests
and frontend typecheck/test pass. See [PLAN.md](PLAN.md) for the full build order.

## Stack

| | |
|---|---|
| API | FastAPI, Python 3.13, SQLAlchemy + asyncpg, PostgreSQL 16 |
| Web | Remix 3.1 on Node 26, Bun for packages and scripts |
| Map | MapLibre GL JS (Phase 4) |
| Weather data | aviationweather.gov (AWC Data API and bulk cache files) |
| Explanations | GLM-4.7-Flash, Gemini Flash, or a local model via any OpenAI-compatible server, behind a citation validator |

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
PLAN.md     Scope, schema, API surface, safety requirements, build order.
```

The split is deliberate: `app/domain/` has no framework imports, because the parsing is
the part that has to be right and the part that is worth reading.

## Tests

```sh
make test    # pytest, then Remix's test runner
make lint    # ruff, then tsc
```

The METAR parser is checked against AWC's own decoder, which needs network:

```sh
make crosscheck   # writes backend/tests/golden/crosscheck.md
```

## Commits

Conventional Commits, enforced by a hook:

```sh
make hooks   # installs scripts/commit-msg as .git/hooks/commit-msg
```

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
