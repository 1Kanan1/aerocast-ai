.DEFAULT_GOAL := help

.PHONY: help install db db-down api web test lint fmt up down

help: ## show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  %-10s %s\n", $$1, $$2}'

install: ## install backend and frontend dependencies
	cd backend && uv sync
	cd frontend && bun install

db: ## start Postgres in Docker on localhost:5433
	docker compose up -d db

db-down: ## stop the Docker Postgres
	docker compose down db

api: ## run the API on :8000 with reload
	cd backend && uv run uvicorn app.main:app --reload --port 8000

web: ## run the Remix app on :44100 with hot reload
	cd frontend && bun run hmr

test: ## run backend and frontend tests
	cd backend && uv run pytest -q
	cd frontend && bun run test

lint: ## ruff and typecheck
	cd backend && uv run ruff check .
	cd frontend && bun run typecheck

fmt: ## format the backend
	cd backend && uv run ruff format .

up: ## run the whole stack in containers
	docker compose up --build

down: ## stop the stack
	docker compose down
