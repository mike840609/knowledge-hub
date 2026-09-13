# Knowledge Hub (HCM-KM) — common workflows.
# First time: `make bootstrap`, then `make dev`.
# Full list: `make help`.

.DEFAULT_GOAL := help

COMPOSE := docker compose
ENV_FILE := .env

.PHONY: help
help: ## Show this help.
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: setup
setup: ## Install dependencies and create .env from example (first time).
	npm ci
	@if [ ! -f $(ENV_FILE) ]; then cp .env.example $(ENV_FILE) && echo "Created $(ENV_FILE) from .env.example."; else echo "$(ENV_FILE) already exists, leaving it alone."; fi

.PHONY: browsers
browsers: ## Install Playwright Chromium (needed once for e2e tests).
	npx playwright install chromium

.PHONY: db-up
db-up: ## Start MariaDB in Docker (waits until healthy).
	$(COMPOSE) up -d --wait mariadb

.PHONY: db-down
db-down: ## Stop MariaDB (keeps the data volume).
	$(COMPOSE) down

.PHONY: db-logs
db-logs: ## Tail MariaDB logs.
	$(COMPOSE) logs -f mariadb

.PHONY: db-migrate
db-migrate: db-up ## Apply schema migrations to the dev database.
	npm run db:migrate

.PHONY: db-seed
db-seed: db-migrate ## Load dev fixtures (idempotent, safe to re-run).
	npm run db:seed

.PHONY: bootstrap
bootstrap: setup db-seed ## First-time setup: install, start DB, migrate, seed.
	@echo "Done. Run 'make dev' and open http://127.0.0.1:3000/knowledge"

.PHONY: dev
dev: db-up ## Start the dev server at http://127.0.0.1:3000/knowledge.
	npm run dev

.PHONY: build
build: ## Production build.
	npm run build

.PHONY: start
start: db-up ## Serve the production build (run 'make build' first).
	npm run start

.PHONY: lint
lint: ## ESLint.
	npm run lint

.PHONY: typecheck
typecheck: ## TypeScript check.
	npm run typecheck

.PHONY: test-unit
test-unit: ## Unit tests (no database needed).
	npm run test:unit

.PHONY: test-integration
test-integration: db-up ## Integration tests (needs MariaDB; uses root creds from .env.example defaults).
	npm run test:integration

.PHONY: test-e2e
test-e2e: db-up ## E2E tests: provisions an isolated DB, builds, runs Playwright (needs 'make browsers' once).
	npm run test:e2e

.PHONY: verify
verify: test-unit typecheck lint build ## Local mirror of the CI DB-free gate.

.PHONY: clean
clean: ## Remove build/test outputs and stop DB (keeps the data volume).
	$(COMPOSE) down
	rm -rf .next coverage playwright-report blob-report

.PHONY: db-reset
db-reset: ## DANGER: wipe the dev database volume, then re-migrate + reseed.
	@echo "Wiping MariaDB data volume..."
	$(COMPOSE) down -v
	$(COMPOSE) up -d --wait mariadb
	npm run db:migrate
	npm run db:seed
