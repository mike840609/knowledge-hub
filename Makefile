# Knowledge Hub (HCM-KM) — common workflows.
# First time: `make bootstrap`, then `make dev`.
# Full list: `make help`.

.DEFAULT_GOAL := help

COMPOSE := docker compose
ENV_FILE := .env

# pnpm is the default local package manager; npm is the fallback.
PNPM := $(shell command -v pnpm 2>/dev/null)
ifneq ($(PNPM),)
RUN := pnpm
else
RUN := npm
endif

.PHONY: help
help: ## Show this help.
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: setup
setup: ## Install dependencies (pnpm 12 when present, npm otherwise) and create .env from example (first time).
	@major=$$(pnpm --version 2>/dev/null | cut -d. -f1); \
	if command -v pnpm >/dev/null 2>&1 && [ -n "$$major" ] && [ "$$major" -ge 12 ] 2>/dev/null; then \
	  echo "Installing dependencies with pnpm $$(pnpm --version)"; \
	  pnpm install; \
	else \
	  echo "pnpm 12 not found; installing dependencies with npm ci"; \
	  npm ci; \
	fi
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
	$(RUN) run db:migrate

.PHONY: db-reindex-links
db-reindex-links: db-up ## Index document links (backfill after migration 012, or repair). Idempotent.
	$(RUN) run db:reindex-document-links

.PHONY: db-report-escaped-wikilinks
db-report-escaped-wikilinks: db-up ## List documents that may have lost wikilinks to the old editor (read-only; changes nothing).
	$(RUN) run db:report-escaped-wikilinks

.PHONY: db-seed
db-seed: db-migrate ## Load dev fixtures (idempotent, safe to re-run).
	$(RUN) run db:seed

.PHONY: bootstrap
bootstrap: setup db-seed ## First-time setup: install, start DB, migrate, seed.
	@echo "Done. Run 'make dev' and open http://127.0.0.1:3000/knowledge"

.PHONY: dev
dev: db-up ## Start the dev server at http://127.0.0.1:3000/knowledge.
	$(RUN) run dev

# A second local user on a second port, for trying what takes two people (sharing, comments).
# The identity is this server's configuration, as it is for `make dev`; the browser chooses nothing.
.PHONY: dev-reviewer
dev-reviewer: db-up ## Start a second dev server as "Local Reviewer" at http://127.0.0.1:3001.
	KM_LOCAL_ID=0199f000-0000-7000-8000-000000000002 KM_LOCAL_EMP_ID=LOCAL-0002 \
	KM_LOCAL_NAME="Local Reviewer" KM_LOCAL_ORG_CODE=LOCAL \
	KM_NEXT_DIST_DIR=.next-dev-reviewer $(RUN) run dev -- --port 3001

.PHONY: build
build: ## Production build.
	$(RUN) run build

.PHONY: start
start: db-up ## Serve the production build (run 'make build' first).
	$(RUN) run start

.PHONY: lint
lint: ## ESLint.
	$(RUN) run lint

.PHONY: typecheck
typecheck: ## TypeScript check.
	$(RUN) run typecheck

.PHONY: test-unit
test-unit: ## Unit tests (no database needed).
	$(RUN) run test:unit

.PHONY: test-integration
test-integration: db-up ## Integration tests (needs MariaDB; uses root creds from .env.example defaults).
	$(RUN) run test:integration

.PHONY: test-e2e
test-e2e: db-up ## E2E tests: provisions an isolated DB, builds, runs Playwright (needs 'make browsers' once).
	$(RUN) run test:e2e

.PHONY: guide-screenshots
guide-screenshots: db-up ## Regenerate the user guide's screenshots from the sample wiki (needs 'make browsers' once).
	KM_GUIDE_CAPTURE=$(CURDIR)/src/components/help/screens $(RUN) run test:e2e -- tests/e2e/user-guide-screenshots.spec.ts

.PHONY: test-mermaid-assumptions
test-mermaid-assumptions: ## What the reader assumes of Mermaid, checked in Chromium; run before changing its version (needs 'make browsers' once).
	$(RUN) run test:mermaid-assumptions

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
	$(RUN) run db:migrate
	$(RUN) run db:seed
