# Vercel + Layerbase deployment

This is the single-operator deployment path: the app runs on Vercel, the database is a
[Layerbase](https://layerbase.com) MariaDB 10.11, and the identity stays the server-configured local
user. It is not a multi-user or company-SSO deployment; see the main README for that contract.

Preview deployments are disabled by `scripts/vercel-ignore.mjs`: they have no database credentials
and would otherwise deploy successfully and then fail on every page.

## 1. Create the database

1. Sign in at <https://layerbase.com> and create a **MariaDB 10.11** database (free plan is enough
   to start). Layerbase's shared fleet has **no region choice**: those databases run in Ashburn,
   Virginia (US East). Dedicated servers can choose a region, but only the US or Brazil. The
   repository's `vercel.json` uses `iad1` so the functions run next to the database; do not change
   it to a region far from US East.
2. Open the database's **Connect** dialog and copy both connection strings:
   - **Pooled** — the runtime URL (`KM_DB_URL`).
   - **Direct** — turn the Pooled toggle off (`KM_DB_MIGRATE_URL`, and the probe fallback).
3. TLS is required. Both strings are `mysql://...`; the app verifies the certificate by default.

Free-plan facts that affect behaviour: 5 GB storage, 20 concurrent client connections, and the
database sleeps when idle. The first connection after a sleep can take up to ~30 seconds while the
engine starts. Paid plans add an always-on pool and more connections.

## 2. Create and link the Vercel project

```sh
vercel login
vercel link          # or import mike840609/knowledge-hub in the Vercel dashboard
```

- Framework preset: **Next.js**. Root directory: the repository root. Production branch: `main`.
- Project → Settings → General → **Node.js Version**: choose **22.x** or **24.x**. Leave
  `package.json`'s `engines.node` at `>=20.19.0 <25`; the platform setting chooses the runtime.
- Preview deployments are skipped by `vercel.json`'s `ignoreCommand`; no preview environment
  variables are needed.

## 3. Set Production environment variables

Use the Vercel dashboard (Project → Settings → Environment Variables) or
`vercel env add <NAME> production`. Scope everything to **Production** only.

Runtime:

| Variable | Value |
| --- | --- |
| `KM_DB_URL` | Layerbase **pooled** URL (or the direct URL if step 4 says so) |
| `KM_DB_SSL` | `verify` |
| `KM_DB_POOL_SIZE` | `2` |
| `KM_DB_CONNECT_TIMEOUT_MS` | `30000` |
| `KM_DB_ACQUIRE_TIMEOUT_MS` | `35000` |
| `KM_IMPORT_MAX_UPLOAD_BATCH_BYTES` | `4194304` |
| `KM_IMPORT_MAX_MARKDOWN_FILE_BYTES` | `4000000` |
| `KM_IDENTITY_PROVIDER` | `local` |
| `KM_LOCAL_IDENTITY_ENABLED` | `true` |
| `KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION` | `true` — single-operator only; never on a shared deployment |
| `KM_LOCAL_ID` / `KM_LOCAL_EMP_ID` / `KM_LOCAL_NAME` / `KM_LOCAL_ORG_CODE` | the same values as the local `.env` |
| `KM_TEAM_WORKSPACES_ENABLED` | `false` |
| `KM_REVIEW_WRITES_ENABLED` | `true` (requires `KM_PUBLIC_ORIGIN`) |
| `KM_PUBLIC_ORIGIN` | `https://<production-domain>` |
| `KM_SITE_PASSWORD` | optional; strongly recommended for a public URL |

Build-only:

| Variable | Value |
| --- | --- |
| `KM_DB_MIGRATE_URL` | Layerbase **direct** URL |
| `KM_MIGRATE_ON_BUILD` | optional; set `0` to skip migrations |

The site password is not a sign-in system. When set, it protects every page and API route except
`/s/*`, `/api/share-review/*`, and `/api/health`, so share links keep working for recipients.

## 4. Probe the connection before trusting the pooler

```sh
KM_DB_URL="<pooled URL>" npm run db:probe
```

Every line must say `PASS`: server version, `READ-COMMITTED`, `+00:00`, `GET_LOCK` acquired, the
lock holder is the same connection, release, and a fresh connection with the same session values.

If any session check fails, the Layerbase pooler does not preserve session state. Set the runtime
`KM_DB_URL` to the **direct** URL instead (no code change) and record why in the deployment notes.
Keep `KM_DB_MIGRATE_URL` direct either way.

## 5. Choose the data path

### Fresh database

```sh
KM_DB_URL="<direct URL>" npm run db:migrate
KM_DB_URL="<direct URL>" npm run db:seed
```

The seed is idempotent and creates the local user, the personal workspace, the demo fixtures, and
the Getting Started tree.

### Copy the local database

Both engines are MariaDB 10.11, so a dump restores directly. Copy data only when the local database
is at the same migration level as the commit you are deploying: the dump carries
`schema_migrations`, and the migration runner rejects unknown versions or checksum mismatches.

```sh
docker compose up -d --wait
docker compose exec -T mariadb mysqldump -uroot -phcm_km_root \
  --single-transaction --routines --triggers hcm_km_dev > km-local.sql

mysql --ssl-mode=REQUIRED -h <host> -P <port> -u <user> -p <database> < km-local.sql
```

Do not run `db:seed` after a dump. Keep the same `KM_LOCAL_*` identity values in Vercel, or the
stored workspace membership will point at a different user.

## 6. Deploy

```sh
vercel --prod
```

or push to `main` if the GitHub integration is connected. The build log must show `next build`
first and `applying database migrations` second. A migration failure fails the deployment; the
previous deployment keeps serving. Migrations are expected to be expand-only for that reason.

## 7. Smoke tests

```sh
curl -fsS https://<domain>/api/health      # {"ok":true}
```

Then, in a browser:

1. Open `/` and land in My Space.
2. Create a document, edit it, and save.
3. Open a share link in a private window; it must not ask for the site password.
4. Post a review reply from the share page (requires `KM_PUBLIC_ORIGIN`).
5. Import a small folder (well under 4 MiB).
6. After the database has been idle, request `/api/health`; the first call may take up to ~30 s.
   A 503 followed by a success on retry is the expected cold-wake shape.

## 8. Troubleshooting

| Symptom | Cause / action |
| --- | --- |
| Every request 503 / times out | The free database is waking. Retry; upgrade to an always-on plan to remove it. |
| `no more connections allowed` | The plan's connection cap is reached. Lower `KM_DB_POOL_SIZE` (1) or upgrade. |
| TLS verification error | Confirm the host. Use `KM_DB_SSL=trust` only after verifying the endpoint cannot present a public certificate. |
| Migration ledger `FAILED` | The migration stopped mid-run. Repair the schema explicitly and clear only that ledger row; never edit checksums. |
| 413 from a folder import | A request exceeded 4.5 MB. Keep each Markdown file under `KM_IMPORT_MAX_MARKDOWN_FILE_BYTES` (4,000,000 bytes in this template); the client rejects an oversized file before upload. Lower `KM_IMPORT_MAX_MANIFEST_ENTRIES` if the manifest itself is too large. |
| Export or a huge document fails | Vercel caps responses at 4.5 MB; the export is buffered. Stream it or split the content in a future change. |
| Preview deployment says “skipped” | Expected. Only production builds run. |

Vercel's Hobby plan is for non-commercial use. This deployment is personal; use a paid plan for
anything commercial.
