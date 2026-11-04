.DEFAULT_GOAL := help

.PHONY: help install hooks db db-down api web test lint fmt crosscheck up down

help: ## show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  %-10s %s\n", $$1, $$2}'

install: ## install backend and frontend dependencies
	cd backend && uv sync
	cd frontend && bun install

hooks: ## install git hooks (conventional commits)
	cp scripts/commit-msg .git/hooks/commit-msg
	chmod +x .git/hooks/commit-msg

db: ## start Postgres in Docker on localhost:5433
	docker compose up -d db

db-down: ## stop the Docker Postgres
	docker compose down db

api: ## run the API on :8000 with reload
	cd backend && uv run uvicorn app.main:app --reload --port 8000

migrate: ## apply pending migrations
	cd backend && uv run alembic upgrade head

ingest: ## run one ingestion cycle now
	cd backend && uv run python -m app.ingest

web: ## run the Remix app on :44100 with hot reload
	cd frontend && bun run hmr

test: ## run backend and frontend tests
	cd backend && uv run pytest -q
	cd frontend && bun run test

lint: ## lint, format check, types
	cd backend && uv run ruff check .
	cd backend && uv run ruff format --check .
	cd backend && uv run ty check
	cd frontend && bun run typecheck

crosscheck: ## compare parsers against AWC's decoder (needs network)
	cd backend && uv run python -m app.tools.crosscheck_metar
	cd backend && uv run python -m app.tools.crosscheck_taf

fmt: ## format the backend
	cd backend && uv run ruff format .

up: ## run the whole stack in containers
	docker compose up --build

down: ## stop the stack
	docker compose down
