# Knowledge Hub (HCM-KM) — common workflows.
# First time: `make bootstrap`, then `make dev`.
# Full list: `make help`.

.DEFAULT_GOAL := help

COMPOSE := docker compose
ENV_FILE := .env
# Local MinIO from compose.yaml; the same four settings a company MinIO needs.
MINIO_ENDPOINT := http://127.0.0.1:9000
MINIO_ACCESS_KEY := hcm_km_minio
MINIO_SECRET_KEY := hcm_km_minio_dev
MINIO_DEV_BUCKET := knowledge-hub-dev
MINIO_TEST_BUCKET := knowledge-hub-test
minio_env = KM_BLOB_DIR= KM_BLOB_S3_ENDPOINT=$(MINIO_ENDPOINT) KM_BLOB_S3_ACCESS_KEY=$(MINIO_ACCESS_KEY) KM_BLOB_S3_SECRET_KEY=$(MINIO_SECRET_KEY) KM_BLOB_S3_BUCKET=$(1)

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

.PHONY: storage-up
storage-up: ## Start local MinIO (image storage, as in production) and create its dev and test buckets.
	$(COMPOSE) up -d minio
	@for i in $$(seq 1 60); do curl -sf $(MINIO_ENDPOINT)/minio/health/live >/dev/null && break; [ $$i -eq 60 ] && { echo "MinIO did not become ready at $(MINIO_ENDPOINT)."; exit 1; }; sleep 1; done
	@$(call minio_env,$(MINIO_DEV_BUCKET)) npx tsx scripts/storage/blobs.ts create-bucket
	@$(call minio_env,$(MINIO_TEST_BUCKET)) npx tsx scripts/storage/blobs.ts create-bucket

.PHONY: db-down
db-down: ## Stop MariaDB (keeps the data volume).
	$(COMPOSE) down

.PHONY: db-logs
db-logs: ## Tail MariaDB logs.
	$(COMPOSE) logs -f mariadb

.PHONY: db-migrate
db-migrate: db-up ## Apply schema migrations to the dev database.
	npm run db:migrate

.PHONY: db-reindex-links
db-reindex-links: db-up ## Index document links (backfill after migration 012, or repair). Idempotent.
	npm run db:reindex-document-links

.PHONY: db-report-escaped-wikilinks
db-report-escaped-wikilinks: db-up ## List documents that may have lost wikilinks to the old editor (read-only; changes nothing).
	npm run db:report-escaped-wikilinks

.PHONY: db-seed
db-seed: db-migrate ## Load dev fixtures (idempotent, safe to re-run).
	npm run db:seed

.PHONY: bootstrap
bootstrap: setup db-seed storage-up ## First-time setup: install, start DB and MinIO, migrate, seed.
	@echo "Done. Run 'make dev' and open http://127.0.0.1:3000/knowledge"

.PHONY: dev
dev: db-up storage-up ## Start the dev server at http://127.0.0.1:3000/knowledge.
	npm run dev

.PHONY: build
build: ## Production build.
	npm run build

.PHONY: start
start: db-up storage-up ## Serve the production build (run 'make build' first).
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
test-integration: db-up storage-up ## Integration tests (needs MariaDB and MinIO; uses root creds from .env.example defaults).
	KM_TEST_S3_ENDPOINT=$(MINIO_ENDPOINT) KM_TEST_S3_ACCESS_KEY=$(MINIO_ACCESS_KEY) KM_TEST_S3_SECRET_KEY=$(MINIO_SECRET_KEY) KM_TEST_S3_BUCKET=$(MINIO_TEST_BUCKET) npm run test:integration

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

.PHONY: blobs-gc
blobs-gc: ## Remove stored images nothing refers to (older than 48 h).
	npx tsx scripts/storage/blobs.ts gc

.PHONY: blobs-verify
blobs-verify: ## List stored images whose file is missing; `make blobs-verify REPAIR=1` re-uploads them on next sync.
	npx tsx scripts/storage/blobs.ts verify $(if $(REPAIR),--repair,)
