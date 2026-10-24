# Vercel + Layerbase deployment design

**Date:** 2026-10-24
**Status:** Proposed
**Scope owner:** single-operator deployment of the Knowledge Hub

## Intent

Run the Knowledge Hub on Vercel as a single-operator deployment, with its database on
[Layerbase](https://layerbase.com) MariaDB. The deployment should feel like the sibling
`asset_tracker` project: a `vercel.json`, a production build that applies schema migrations, and a
hosted database. Identity stays exactly as it is today — one server-configured user — so no sign-in
product work is in scope.

## Goals

- Deploy the existing Next.js 15.5 app to Vercel (Node runtime), keeping application behaviour
  unchanged apart from the platform-limit adjustments in §9.
- Use Layerbase **MariaDB 10.11**, the same engine version as local development, so the 25
  migrations and every raw SQL statement keep their current semantics.
- Apply migrations during production builds (decision A), with the app and schema moving together.
- Support both a fresh database (migrate + seed) and a copy of the current local database.
- Provide an opt-in, infrastructure-level site password so a URL alone is not the only secret.
- Leave a reproducible local verification story: typecheck, lint, unit tests, DB-free build.

## Non-goals

- Multi-user authentication, Google/OAuth, company SSO, invitations, or per-user sessions.
- Team workspace enablement (`KM_TEAM_WORKSPACES_ENABLED` stays `false`).
- Binary/file storage; the app remains metadata-only.
- A PostgreSQL port or an ORM.
- Per-preview database branching (Layerbase's Vercel integration) in this iteration.
- Migrating to MySQL 8; MariaDB 10.11 is free and matches local.

## What already fits

Verified in the repository before writing this design:

- `npm run build` succeeds with an unreachable database; every application route is dynamic
  (`ƒ`) because the root layout reads headers. A DB-free Vercel build is therefore possible.
- There is no `node:fs` usage in `src/`; uploads are metadata and Markdown rows, not files.
- All production SQL goes through one `mariadb` pool built in
  `src/infrastructure/database/mariadb/pool.ts`; there is no second driver.
- The pool already supports `idleTimeout`, `minimumIdle`, `acquireTimeout`, `connectTimeout`, and
  `ssl`. `mariadb` also parses `mariadb://` URLs, though this design parses `KM_DB_URL` itself.
- `src/server/composition.ts` pins the pool on `globalThis`, which is correct for Fluid Compute
  instance reuse.

## Constraints

- **Layerbase Free MariaDB**: 20 concurrent client connections, 5 GB, TLS required, no always-on
  pool. The database sleeps when idle; the first connection can take ~30 s while the engine
  starts. Paid plans add an always-on pool.
- **MySQL-family pooler**: Layerbase's pooled string still uses a dedicated port and the direct
  port enforces 20 new connections per 10 s per source IP. Serverless egress shares NAT addresses,
  so connection churn must stay low.
- **Session-scoped behaviour**: the app sets `SET SESSION TRANSACTION ISOLATION LEVEL READ
  COMMITTED` in `initSql` and uses `GET_LOCK`/`RELEASE_LOCK` for migration serialization and
  import quota. A transaction-mode pooler may not preserve either. This must be verified against
  the real database, not assumed.
- **Vercel Fluid Compute**: Hobby default maximum duration is 300 s, so a 30 s cold wake fits
  without per-route `maxDuration` configuration.
- **Production identity**: `createIdentityProvider` refuses local identity under
  `NODE_ENV=production` unless `KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION=true`. That flag is the
  deliberate, documented exception for this single-operator deployment.
- **Review writes** require `KM_PUBLIC_ORIGIN` to match the browser origin; it must be set to the
  production URL.

## Approaches considered

1. **Layerbase PostgreSQL + port the SQL.** Rejected: 46k LOC, 25 migrations, and hand-written
   MySQL-specific SQL (`JSON_VALID`, `GET_LOCK`, `ON DUPLICATE KEY`, `DATETIME(6)`); the port is
   large, risks silent semantic drift, and buys nothing for one user.
2. **Layerbase MySQL 8 (Solo, $5/mo).** Rejected for now: MariaDB 10.11 is free, wire-compatible,
   and identical to local. Layerbase can convert MariaDB → MySQL later in one click if an
   always-on database is wanted.
3. **MariaDB 10.11 + pooled runtime + migrations during production builds (chosen).** Matches
   `asset_tracker`'s deployment shape and keeps schema and code in lockstep.
4. **MariaDB 10.11 + manual migrations before deploy.** Rejected as the default (user picked A):
   fewer moving parts in the build, but schema can silently lag the code.

## Design

### 1. Connection configuration

Extend `src/infrastructure/database/mariadb/config.ts`:

- `KM_DB_URL` is the preferred source. Accept `mysql://` and `mariadb://`; `URL`-parse it, decode
  user/password, and derive host, port, database. Empty port falls back to 3306. Unknown query
  parameters are ignored.
- The existing `KM_DB_HOST`/`PORT`/`USER`/`PASSWORD`/`NAME` variables remain the fallback, so local
  development and the integration/E2E harnesses are unchanged.
- `KM_DB_SSL`:
  - `verify` (default when `KM_DB_URL` is set) → `ssl: { rejectUnauthorized: true }`.
  - `trust` → `ssl: { rejectUnauthorized: false }`; logs a warning at pool creation.
  - `off` (default when only individual variables are set) → no `ssl`.
- `KM_DB_POOL_SIZE` overrides `connectionLimit`; default 10 locally and 2 when `process.env.VERCEL`
  is set.
- `KM_DB_CONNECT_TIMEOUT_MS` (default 30000) and `KM_DB_ACQUIRE_TIMEOUT_MS` (default 35000) cover
  Layerbase's cold wake.
- Credentials are never logged. Connection errors are surfaced without the URL.

Parser and SSL-mode mapping live in small pure functions with unit tests.

### 2. Pool tuning

`createDatabasePool` gains serverless-safe defaults while keeping current semantics:

- `minimumIdle: 0`
- `idleTimeout: 60` (seconds) — releases pooler slots well before Layerbase's 5-minute idle sweep
- `connectionLimit` from config (2 on Vercel)
- keep `timezone: "Z"`, `bigIntAsNumber`, `insertIdAsNumber`
- extend `initSql` to an array of two session statements:
  `SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED` and
  `SET SESSION time_zone = '+00:00'`. The app mixes driver-written UTC dates with server-side
  `CURRENT_TIMESTAMP(6)` defaults; pinning the session to UTC keeps them consistent on a host
  whose default time zone is not UTC. The driver accepts `initSql` as `string[]`, so this needs no
  extra round trips.

No query-level retries are added. A cold wake is handled by the 30 s connect timeout; if it still
fails, the first request returns an error and the next one normally succeeds. The health endpoint
and deployment doc give an explicit warm-up path. Adding retries around arbitrary statements would
risk duplicate writes and is out of scope.

### 3. Migrations during production builds

New `scripts/vercel-build.mjs`, referenced from `vercel.json`:

1. Run `next build` first (via the existing `scripts/build.mjs`). The build is DB-free, so this
   cannot fail because of the database.
2. If `VERCEL_ENV === "production"` and `KM_MIGRATE_ON_BUILD !== "0"`:
   - choose `KM_DB_MIGRATE_URL` when present, otherwise fall back to `KM_DB_URL` with a loud
     warning that session locks may not hold through a pooler;
   - run `npm run db:migrate` with that URL exported as `KM_DB_URL`;
   - any non-zero exit fails the deployment.
3. When `VERCEL_ENV` is `preview`/`development`, skip migrations and log why.

Migration runs **after** the build on purpose. Vercel keeps the previous deployment serving until
the new one is promoted, so building first removes the long "new schema + old code" window. The
remaining window is migrate → promote (seconds), and a build failure leaves the schema untouched.
Migrations are expected to be expand-only for the same reason; destructive changes should follow
the existing cutover-runbook pattern.

The migration runner is unchanged: it already validates the full manifest, records checksums, and
serializes through `GET_LOCK`. Because it runs over the **direct** connection, both the lock and
the session isolation behave as they do locally. Concurrent builds serialize on the lock.

`KM_DB_MIGRATE_URL` is a Production-scoped Vercel variable; previews have no database credentials
and therefore cannot touch production data.

### 4. Session-affinity probe

New `scripts/db/probe-session.ts` (`npm run db:probe`), run once against the real Layerbase
database before trusting it:

- Acquire one connection; `SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED`; then read
  `@@transaction_isolation` several times on that same connection.
- Acquire a separate connection and read `@@transaction_isolation` (checks `initSql`).
- `SELECT GET_LOCK('km_probe', 2)`, then `SELECT IS_USED_LOCK('km_probe')` and
  `SELECT CONNECTION_ID()`; release and confirm release.
- `@@session.time_zone` must be `+00:00`; `@@version` is recorded for the deployment log.

Decision rule written into the deployment doc:

- All pass → use the pooled string for the app (`KM_DB_URL`) and the direct string for migrations.
- Isolation, `GET_LOCK`, or the UTC session does not hold → point `KM_DB_URL` at the **direct**
  string. No code change; the pool is small and this is a single-operator app, so the
  20-connection ceiling is acceptable.

### 5. Health endpoint

New `GET /api/health`:

- `export const dynamic = "force-dynamic"`.
- Runs `SELECT 1` through the shared pool; returns `{ ok: true }`.
- No identity, no secrets, no cache headers.
- Used for warm-up, smoke tests, and uptime checks.

### 6. Optional site password

When `KM_SITE_PASSWORD` is unset, behaviour is unchanged. When set, `src/middleware.ts` requires
HTTP Basic auth:

- Exempt: `/s/*`, `/api/share-review/*`, `/api/health`, and Next static assets.
- Everything else — pages **and** `/api/*` — requires the password.
- The middleware matcher is broadened to cover API routes. CSP handling stays page-only; API
  responses keep the static CSP from `next.config.ts`.
- Constant-time comparison through Web Crypto digests (Edge-compatible). A page navigation that
  fails returns 401 with `WWW-Authenticate: Basic realm="Knowledge Hub"` so the browser prompts; an
  `/api/*` 401 omits the header, because a public share page's gated fetch must not raise a
  credential dialog over the document.
- This is deliberately not authentication: identity is still the configured local user. It only
  prevents "anyone with the URL is the operator".

The deployment doc recommends setting it and warns that it must not be reused elsewhere.

### 7. Vercel configuration

New `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "installCommand": "npm ci",
  "buildCommand": "node scripts/vercel-build.mjs",
  "ignoreCommand": "node scripts/vercel-ignore.mjs",
  "regions": ["iad1"]
}
```

- `scripts/vercel-ignore.mjs` exits `0` (skip) for every `VERCEL_ENV` other than `production`, so
  preview deployments are not built at all. This is deliberate: previews have no database
  credentials and would otherwise deploy successfully and then 500 on every page. The rule is one
  file and can be relaxed later if a preview database story is added.
- No `crons`: the free database sleeps regardless, and import cleanup already runs opportunistically
  on import requests.
- No `maxDuration`: Fluid Compute's 300 s default covers the worst cold wake.
- Keep `package.json` `engines.node` as `>=20.19.0 <25`. Choose the runtime in the Vercel
  project's Node.js Version setting (22.x or 24.x); do not narrow the package range for one host.
- A minimal `.vercelignore` excludes build artifacts (`playwright-report`, `test-results`,
  `*.tsbuildinfo`, `.next-dev`) but keeps tests and scripts that `next build` type-checks.

### 8. Environment variables

Runtime (Production scope only — preview builds are disabled in §7):

| Variable | Value |
| --- | --- |
| `KM_DB_URL` | Layerbase **pooled** MariaDB URL (or direct if the probe says so) |
| `KM_DB_SSL` | `verify` |
| `KM_DB_POOL_SIZE` | `2` |
| `KM_IMPORT_MAX_UPLOAD_BATCH_BYTES` | `4194304` |
| `KM_IMPORT_MAX_MARKDOWN_FILE_BYTES` | `3670016` |
| `KM_IDENTITY_PROVIDER` | `local` |
| `KM_LOCAL_IDENTITY_ENABLED` | `true` |
| `KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION` | `true` |
| `KM_LOCAL_ID` / `KM_LOCAL_EMP_ID` / `KM_LOCAL_NAME` / `KM_LOCAL_ORG_CODE` | same values as local `.env` |
| `KM_TEAM_WORKSPACES_ENABLED` | `false` |
| `KM_REVIEW_WRITES_ENABLED` | `true` (requires the next line) |
| `KM_PUBLIC_ORIGIN` | `https://<production-domain>` |
| `KM_SITE_PASSWORD` | optional, recommended |

Build-only (Production):

| Variable | Value |
| --- | --- |
| `KM_DB_MIGRATE_URL` | Layerbase **direct** MariaDB URL |
| `KM_MIGRATE_ON_BUILD` | optional `0` to disable |

`.env.example` gains commented templates for all of the above, using placeholders rather than real
credentials.

### 9. Vercel platform limits

Vercel Functions cap request **and** response bodies at 4.5 MB, and Routing Middleware caps the
request body it receives at **4 MB**. Decisions:

- **Middleware body**: `vercel.json` sets `skipMiddlewareRequestBody: true`. The middleware never
  reads a body; without this option the 4 MiB import batches (plus multipart framing) would exceed
  the 4 MB middleware cap before reaching the function. The function still receives the body and
  keeps the 4.5 MB cap. Verify with a real ~4 MiB import after the first deploy.
- **Folder-import upload batches**: 4 MiB of file bytes (`MAX_UPLOAD_BATCH_BYTES` in
  `src/lib/upload-limits.ts`) plus multipart framing stays under the 4.5 MB function cap. The
  production environment sets `KM_IMPORT_MAX_UPLOAD_BATCH_BYTES=4194304` and
  `KM_IMPORT_MAX_MARKDOWN_FILE_BYTES=3670016`; the client clamps each Markdown file to the smaller
  of that server limit and the batch cap, and a platform 413 becomes a readable size error.
- **Document authoring**: `MAX_MARKDOWN_BYTES` is 3.5 MiB (3,670,016 bytes). A save is a JSON body,
  so 3.5 MiB leaves room for escaping and metadata under 4.5 MB. The draft hint uses the same
  constant and flags an oversized draft before saving.
- **Import manifest**: the client posts one JSON manifest. With the default 20,000-entry ceiling
  and realistic paths this is normally below 4.5 MB, but pathological paths can exceed it. The
  deployment doc lists lowering `KM_IMPORT_MAX_MANIFEST_ENTRIES` in production as the remedy, with
  no code change.
- **Exports and very large documents**: `GET /api/workspaces/:workspaceId/export` buffers a ZIP,
  and a rendered document page includes its Markdown. A response above 4.5 MB fails at the platform
  edge. This is recorded as a known limitation; streaming the export is future work, not part of
  this iteration.

### 10. Data bootstrap

Both paths are documented; the choice is made at deploy time.

- **Fresh:** with the direct URL exported as `KM_DB_URL`, run `npm run db:migrate` then
  `npm run db:seed` from the laptop. The seed is idempotent and creates the local user, personal
  and team fixtures, and the Getting Started tree.
- **Copy of local data:** dump the local MariaDB 10.11 database (no `--databases`, so the target
  name is free), then import through the `mysql` client with `--ssl-mode=REQUIRED`. The dump
  includes `schema_migrations`, whose checksums match this commit. Identity IDs are identical
  because the same `KM_LOCAL_*` values are used in both places.

No data is copied automatically by the build.

### 11. Documentation

New `docs/operations/vercel-layerbase.md` (English, matching the existing operations docs) with:

- Create the Layerbase MariaDB 10.11 database; capture pooled and direct URLs.
- Layerbase's shared fleet has no per-database region choice: those databases run in Ashburn,
  Virginia (US East). Dedicated servers can choose a region, but only US East, US West, or São
  Paulo. Run the Vercel functions in `iad1` so the app and database share a region.
- Set the environment variables above.
- `vercel login` / `vercel link` or connect the GitHub repository; deploy.
- Run the probe; record which URL the runtime uses.
- Migrate + seed **or** dump/import local data.
- Smoke tests and troubleshooting (cold wake, 20-connection cap, TLS verification, migration
  ledger failures, skipped preview builds).

`README.md` gains a short "Deployment" section linking to it.

## Risks and how they are handled

- **Pooler drops session settings.** Probe decides; the documented fallback is the direct URL.
- **Cold starts.** 30 s connect timeout; documented warm-up via `/api/health`. Upgrading the
  Layerbase plan to an always-on pool removes the issue without code changes.
- **20 concurrent connections.** Pool of 2, `minimumIdle: 0`, 60 s idle release.
- **Old commit redeployed against a newer schema.** The migration runner already rejects unknown
  ledgers and checksum mismatches; the build fails rather than serving wrong data.
- **Public URL equals operator access.** `KM_SITE_PASSWORD` (recommended) and the doc's warning.
- **Vercel build differences.** `npm ci` + `patch-package` are exercised by a real deploy; the
  existing `next build` is unchanged.
- **Vercel Hobby is for non-commercial use.** This is a personal deployment; note it in the doc.

## Verification

- Local: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build` (with no
  database reachable).
- New unit tests: connection-URL parsing, SSL mode mapping, serverless pool defaults, Basic-auth
  path/password predicate.
- Remote, once credentials exist: `npm run db:probe`, migrate twice (idempotency), health check,
  `/` → personal home, create/edit a document, share-link read, review write with the production
  origin, and a folder import with a batch close to the 4 MiB ceiling (create → upload → finalize →
  apply). Also confirm a non-production branch produces a skipped Vercel build rather than a
  deployed but broken preview.
- Cold start: after the database sleeps, measure the first `/api/health` and the first page load.

## Left to the deployer

- Provide Layerbase credentials and run `vercel login` (the local CLI token is currently invalid).
- Choose the Layerbase plan (shared/free vs dedicated); the shared fleet's region is fixed.
- Choose fresh seed vs. local-data copy.
- Decide whether to set `KM_SITE_PASSWORD`.
