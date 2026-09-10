# Local setup and verification

Phase 0 runs with Node.js `>=20.9.0 <25`, npm, Docker, and the MariaDB 10.11 Compose service. The checked runtime was Node.js `v24.19.0`; the database reported MariaDB `10.11.19-MariaDB`.

## Start the local stack

```sh
cp .env.example .env
npm ci
docker compose up -d --wait
npm run db:migrate
npm run db:seed
npm run dev
```

The Compose service is published only on `127.0.0.1:3307`. The development database is `hcm_km_dev`; the example credentials are local development values and must not be reused as production credentials. Local identity is enabled only when `KM_LOCAL_IDENTITY_ENABLED=true` and is read from the four `KM_LOCAL_*` variables. Form fields cannot replace it.

The seed creates a `Local Knowledge` Workspace, a membership for the configured local user, a HUB_MANAGED source, and a `Getting Started` folder. Knowledge access is checked through Workspace membership; `org_code` is an identity attribute and does not grant access by itself.

## Checks

```sh
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
```

`test:integration` provisions a database named `hcm_km_test_*`, runs migrations, runs the real MariaDB integration suites, and drops only the handle it created. `test:e2e` does the same with `hcm_km_e2e_*`, builds a production server, starts it on the isolated local port, runs Chromium, and removes its database. Neither command reuses the development database. Integration coverage includes cross-org Workspace members, same-org non-members, direct resource UUID checks, two-connection version races, and rollback.

The migration runner is forward-only. A failed or unknown ledger row is a hard error; rebuild the disposable database or repair the migration explicitly after investigating the recorded diagnostic.

## Scope

Phase 0 provides the Workspace/Membership access foundation, stable Document／Revision／Tree core, Local Identity, SourceEntry version guard, metadata-only assets, and the minimal Workspace → Source → Tree web flow. Folder scanning, Preview／Confirm／Apply product UI, enterprise SSO and production governance, publishing, search, MCP, embeddings, memory, binary storage, and hard delete remain later-phase work.
