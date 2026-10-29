# Local setup and verification

**English** | [繁體中文](local-setup.zh-TW.md)

Knowledge Hub runs on Node.js `>=20.19.0 <25`, npm, Docker, and the MariaDB 10.11 Compose service. The repository pins Node.js `24.19.0` in [`.node-version`](../../.node-version).

## Start the local stack

The shortest path is:

```sh
make bootstrap
make dev
```

`make bootstrap` installs dependencies, creates `.env` from `.env.example` when needed, starts MariaDB, runs migrations, and loads development fixtures. `make dev` starts the app at `http://127.0.0.1:3000/`.

Without `make`:

```sh
cp .env.example .env
npm ci
docker compose up -d --wait mariadb
npm run db:migrate
npm run db:seed
npm run dev
```

The Compose service is published only on `127.0.0.1:3307`. The development database is `hcm_km_dev`; the example credentials are local development values and must not be reused as production credentials.

## Local identity and fixtures

Local identity is enabled only when `KM_LOCAL_IDENTITY_ENABLED=true` and is read from the four `KM_LOCAL_*` variables. It is server configuration, not a login form, so the browser cannot choose a different person.

On the first request, the local user receives a personal workspace, **My Space**, with its default **Notes** source. The seed also creates a separate **Local Knowledge** workspace with a `Local Hub` HUB_MANAGED source and a `Getting Started` folder. Knowledge access is checked through workspace membership; `org_code` is an identity attribute and does not grant access by itself.

To try a second person locally, run `make dev-reviewer` in another terminal. It starts the same application as **Local Reviewer** on port 3001 against the same database. See [Trying two-person flows locally](two-person-demo.md) for the sharing and discussion walkthrough.

The import page's **Try with a sample wiki** imports the bundled English or Traditional Chinese sample through the normal Preview → Apply flow. It is the quickest way to populate a fresh workspace with linked documents.

## Checks

```sh
make verify
make test-integration
make browsers
npm run test:e2e:smoke
npm run test:e2e:smoke:personal
```

`make verify` runs unit tests, TypeScript, lint, and a production build. `make test-integration` provisions a database named `hcm_km_test_*`, runs migrations, runs the real MariaDB integration suites, and drops only the database it created. `make test-e2e` does the same with `hcm_km_e2e_*`, builds a production server, starts it on the isolated local port, runs Chromium, and removes its database. Neither command reuses the development database.

The full E2E suite enables Team mode by default. Run the personal rollout separately:

```sh
npm run test:e2e
KM_E2E_PERSONAL_ONLY=true npm run test:e2e -- personal-workspace.spec.ts
```

Additional maintenance checks:

```sh
make guide-screenshots
make test-mermaid-assumptions
```

`make guide-screenshots` regenerates the in-app user guide's committed images from a fresh account and the sample wiki. `make test-mermaid-assumptions` checks what the reader assumes of Mermaid in Chromium; run it before and after changing the Mermaid version.

The migration runner is forward-only. A failed or unknown ledger row is a hard error; rebuild the disposable database or repair the migration explicitly after investigating the recorded diagnostic.

## Current scope

The application currently provides the personal workspace (Home, Inbox with the selected discussion beside the list at wide widths, drafts, favorites, recent documents), folder import and sync, search and the command palette, wikilinks and backlinks, the knowledge graph, rendered and Markdown-source editing, revision history, sharing and discussions, saved shares, export, Copy for Agent, and the opt-in Team workspace surface.

Known limits are listed in the [README](../../README.md#current-limitations-and-future-direction). In particular, attachments are metadata-only, search is keyword-based, Team workspaces remain opt-in, and discussion writes are separately gated by `KM_REVIEW_WRITES_ENABLED`.
