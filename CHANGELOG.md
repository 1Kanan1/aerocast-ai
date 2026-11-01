# Changelog

Notable changes to AeroCast AI. Format follows [Keep a Changelog](https://keepachangelog.com)
and versions follow SemVer, with the version staying in `0.x` while the product shape is
still moving.

The detailed record is `git log`, since every commit follows Conventional Commits. This file
is the readable summary: what was added, what changed, what was removed, and what was
measured. Dates are the day the change landed.

## [Unreleased] 0.1.0, 2026-11-01

Phase 0 (scaffolding) and Phase 1 (deterministic domain layer) are complete.

### Added

**Backend**

- FastAPI app with `/api/health`, `/api/docs`, `/api/openapi.json`, and a lifespan that
  logs database and provider status at boot.
- Settings layer reading the repo-root `.env`: `SecretStr` for every credential,
  `DATABASE_URL` scheme normalisation (`postgres://`, `postgresql://` and
  `postgresql+asyncpg://` all accepted), ordered `LLM_CHAIN`, and aliases so `mlx` and
  `omlx` both resolve to the local provider.
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

**Frontend**

- Remix 3.1 app on Node 26, with Bun for package management and script running.
- Server-rendered status page in monochrome tokens, showing API, database and explanation
  status, plus the flight-planning disclaimer.
- Same-origin API client with a 3 s timeout, `AbortSignal` combining, and explicit handling
  of the 503 health response.

**Tooling and infrastructure**

- `compose.yaml` (Postgres, API, web), `Makefile`, `.env.example`, backend and frontend
  Dockerfiles, and a GitHub Actions workflow.
- ruff, pytest, pytest-asyncio, and ty, wired into `make lint` and CI.
- `scripts/commit-msg` plus `make hooks`: rejects non-Conventional-Commit subject lines and
  exempts git-generated `Merge` and `Revert`.
- 100 backend tests, including a guard that fails if anything under `domain/` imports a web
  framework, database driver, HTTP client, or model provider.

### Changed

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

### Fixed

- **Temperature agreement with AWC fell from 42% to 99.96%** once remarks `T`-groups were
  parsed. Dewpoint, winds, visibility, altimeter and cloud layers are at 100%.
- The cross-check harness was dropping **1,460 of 2,383 visibility comparisons** because the
  cache writes `10+` for ten miles or more and `float()` rejected it.
- The cache writes the literal string `null` for a missing flight category; it was being read
  as a value and counted as a disagreement.
- AWC encodes vertical visibility as `OVX` in the cache and caps "10 km or more" at 6.0 SM.
  Both normalized in the harness rather than in the domain layer.
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

| Commit | Subject |
| --- | --- |
| `fddb0f2` | feat: scaffold FastAPI API and Remix web app with health wiring |
| `7531c85` | feat(llm): add a local provider as the third rung in the chain |
| `b44eee0` | refactor(llm): make the local provider runtime-agnostic |
| `915e0dc` | chore: enforce conventional commit messages |
| `3b7b695` | fix(llm): pin the Gemini model id instead of the -latest alias |
| `5caf26b` | feat(metar): add deterministic parser, flight category, and AWC cross-check |
| `d5f67f0` | feat(domain): add TAF parser, fact bundle, and a purity guard |
| `36c59cf` | chore(backend): add ty and fix the diagnostics it found |

## Conventions

Change types come from Conventional Commits: `feat`, `fix`, `chore`, `docs`, `refactor`,
`test`, `build`, `ci`, `perf`, `style`. Scopes name a domain area (`metar`, `taf`, `llm`,
`brief`) rather than an app, since most work lands in one app.

New entries go under `[Unreleased]` in the matching heading. When a release is tagged, the
section is renamed to the version and a fresh `[Unreleased]` starts above it.
