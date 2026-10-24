# Vercel + Layerbase Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the Knowledge Hub to Vercel with a Layerbase MariaDB 10.11 database, production-only build-time migrations, and no change to the single-operator identity model.

**Architecture:** Keep the existing Next.js + raw-SQL architecture. Add a connection-URL/SSL layer to the `mariadb` pool, a production build script that runs `next build` and then migrations over a direct connection, an operational health endpoint and session probe, an opt-in Basic-auth middleware gate, and a 4 MiB folder-import batch ceiling for Vercel's 4.5 MB request limit.

**Tech Stack:** Next.js 15.5.25, React 19, `mariadb` Node connector, Vitest, Node 24, Vercel, Layerbase MariaDB 10.11.

**Spec:** `docs/superpowers/specs/2026-10-24-vercel-layerbase-deployment-design.md`

## Global Constraints

- Node `24.x`; do not add runtime dependencies.
- Keep MariaDB/MySQL SQL and the existing pool/unit-of-work architecture.
- Production pool: `connectionLimit` 2, `minimumIdle` 0, `idleTimeout` 60 s, `connectTimeout` 30000 ms, `acquireTimeout` 35000 ms. Local defaults stay 10 connections.
- Session init is exactly: `SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED` and `SET SESSION time_zone = '+00:00'`.
- Migrations run only when `VERCEL_ENV === "production"` and after `next build`; they use `KM_DB_MIGRATE_URL` (direct), falling back to `KM_DB_URL` with a warning.
- Preview builds are skipped; never deploy a preview against the production database.
- Vercel request/response cap is 4.5 MB; the folder-import batch ceiling becomes 4 MiB (`4194304` bytes).
- Identity stays `local` with the existing `KM_LOCAL_*` values; `KM_SITE_PASSWORD` is the only new access control and is off when unset.
- Never log a connection URL, password, or database secret.
- All new tests live under `tests/unit/` and run with `npx vitest run --config vitest.config.ts`.

## Review Focus

- A `KM_DB_URL` containing `@`, `/`, `%`, or an empty port must parse correctly, and any parse error must not echo the URL (it contains the password).
- A pooled Layerbase connection that silently loses `SET SESSION` or `GET_LOCK` must fail the probe loudly instead of running under REPEATABLE READ or an unheld lock.
- With `KM_SITE_PASSWORD` set, `/s/*` pages and `/api/share-review/*` must stay reachable with no credentials, while owner pages and every other `/api/*` route return 401 without them.
- The first request after the free database sleeps must either succeed within the 30 s connect timeout or return a clean 503 from `/api/health`, never hang the process.
- A folder import at the 4 MiB boundary (several files, multipart overhead) must split into batches that stay under Vercel's 4.5 MB cap.
- A preview build or a production build with migrations disabled must leave the schema untouched.

---

### Task 1: Connection URL, TLS, and pool configuration

**Files:**
- Modify: `src/infrastructure/database/mariadb/config.ts`
- Modify: `src/infrastructure/database/mariadb/pool.ts`
- Test: `tests/unit/database-config.test.ts` (create)

**Interfaces:**
- Produces:
  - `type DatabaseSslMode = "off" | "verify" | "trust"`
  - `type DatabaseConfig = { host: string; port: number; user: string; password: string; database: string; connectionLimit?: number; connectTimeout?: number; acquireTimeout?: number; ssl?: false | { rejectUnauthorized: boolean } }`
  - `parseConnectionUrl(raw: string): { host: string; port: number; user: string; password: string; database: string }`
  - `sslOption(mode: string): false | { rejectUnauthorized: boolean }`
  - `databaseConfig(kind?: "dev" | "test" | "e2e"): DatabaseConfig`
  - `SESSION_INIT_SQL: string[]` exported from `pool.ts`
- Consumes: existing `KM_DB_*`, `KM_TEST_DB_*`, `KM_E2E_DB_*` variables.

- [ ] **Step 1: Write the failing tests**

`tests/unit/database-config.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { databaseConfig, parseConnectionUrl, sslOption } from "@/infrastructure/database/mariadb/config";
import { SESSION_INIT_SQL } from "@/infrastructure/database/mariadb/pool";

afterEach(() => vi.unstubAllEnvs());

describe("parseConnectionUrl", () => {
  it("parses a mariadb URL with an encoded password and explicit port", () => {
    expect(parseConnectionUrl("mariadb://km:p%40ss%2Fword@db.example.com:3307/hcm_km?ssl-mode=REQUIRED"))
      .toEqual({ host: "db.example.com", port: 3307, user: "km", password: "p@ss/word", database: "hcm_km" });
  });

  it("defaults the port to 3306 and accepts mysql://", () => {
    expect(parseConnectionUrl("mysql://u:p@host/db")).toEqual({ host: "host", port: 3306, user: "u", password: "p", database: "db" });
  });

  it("rejects a non-MySQL protocol without echoing the secret", () => {
    expect(() => parseConnectionUrl("postgres://u:secret@host/db")).toThrow(/mysql:\/\/ or mariadb:\/\//);
    try { parseConnectionUrl("postgres://u:secret@host/db"); } catch (error) { expect(String(error)).not.toContain("secret"); }
  });

  it("rejects a missing database name", () => {
    expect(() => parseConnectionUrl("mysql://u:p@host/")).toThrow(/database/i);
  });
});

describe("sslOption", () => {
  it.each([["off", false], ["verify", { rejectUnauthorized: true }], ["trust", { rejectUnauthorized: false }]] as const)("maps %s", (mode, expected) => {
    expect(sslOption(mode)).toEqual(expected);
  });
  it("rejects an unknown mode", () => { expect(() => sslOption("maybe")).toThrow(/KM_DB_SSL/); });
});

describe("databaseConfig", () => {
  it("uses KM_DB_URL with verify TLS and a two-connection pool on Vercel", () => {
    vi.stubEnv("KM_DB_URL", "mysql://u:p@h:3307/db");
    vi.stubEnv("VERCEL", "1");
    expect(databaseConfig("dev")).toMatchObject({
      host: "h", port: 3307, user: "u", password: "p", database: "db",
      connectionLimit: 2, connectTimeout: 30000, acquireTimeout: 35000,
      ssl: { rejectUnauthorized: true },
    });
  });

  it("keeps the individual variables as the local fallback", () => {
    vi.stubEnv("KM_DB_URL", "");
    vi.stubEnv("KM_DB_PORT", "3307");
    vi.stubEnv("KM_DB_HOST", "127.0.0.1");
    vi.stubEnv("VERCEL", "");
    expect(databaseConfig("dev")).toMatchObject({ host: "127.0.0.1", port: 3307, connectionLimit: 10, ssl: false });
  });

  it("ignores KM_DB_URL for the test and e2e harnesses", () => {
    vi.stubEnv("KM_DB_URL", "mysql://u:p@remote/db");
    vi.stubEnv("KM_TEST_DB_HOST", "test-host");
    expect(databaseConfig("test").host).toBe("test-host");
  });
});

describe("session init", () => {
  it("pins READ COMMITTED and UTC", () => {
    expect(SESSION_INIT_SQL).toEqual([
      "SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED",
      "SET SESSION time_zone = '+00:00'",
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/database-config.test.ts`
Expected: FAIL — `parseConnectionUrl`/`sslOption`/`SESSION_INIT_SQL` are not exported.

- [ ] **Step 3: Implement the config and pool changes**

In `config.ts`:
- Extend `DatabaseConfig` with `connectTimeout`, `acquireTimeout`, `ssl`.
- Add `parseConnectionUrl` using `new URL`; accept only `mysql:`/`mariadb:`, require host and a non-empty database, default port 3306, `decodeURIComponent` user/password. Error text must not include the raw URL.
- Add `sslOption(mode: string)` with the three modes; unknown throws `Error("KM_DB_SSL must be off, verify, or trust.")`.
- In `databaseConfig`, for `kind === "dev"` and a non-empty `KM_DB_URL`, return the parsed values plus:
  - `connectionLimit`: `Number(process.env.KM_DB_POOL_SIZE ?? (process.env.VERCEL ? 2 : 10))`; reject non-integers/≤0.
  - `connectTimeout`: `Number(process.env.KM_DB_CONNECT_TIMEOUT_MS ?? 30000)`.
  - `acquireTimeout`: `Number(process.env.KM_DB_ACQUIRE_TIMEOUT_MS ?? 35000)`.
  - `ssl`: `sslOption(process.env.KM_DB_SSL ?? "verify")`.
- For individual-variable config, keep the existing values and add the same pool/timeouts, with `ssl: process.env.KM_DB_SSL ? sslOption(process.env.KM_DB_SSL) : false`.
- `adminDatabaseConfig` stays on the individual variables.

In `pool.ts`:
- Export `SESSION_INIT_SQL = [SESSION_ISOLATION_SQL, "SET SESSION time_zone = '+00:00'"]`.
- Pass `ssl: config.ssl`, `minimumIdle: 0`, `idleTimeout: 60`, `connectTimeout: config.connectTimeout ?? 10000`, `acquireTimeout: config.acquireTimeout ?? 10000`, and `initSql: SESSION_INIT_SQL` to `mariadb.createPool`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --config vitest.config.ts tests/unit/database-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/database/mariadb/config.ts src/infrastructure/database/mariadb/pool.ts tests/unit/database-config.test.ts
git commit -m "feat(db): support connection URLs, TLS, and serverless pool limits"
```

---

### Task 2: Health endpoint and session probe

**Files:**
- Create: `src/server/database-health.ts`
- Create: `src/app/api/health/route.ts`
- Create: `scripts/db/probe-session.ts`
- Modify: `src/server/composition.ts` (export `getDatabasePool`)
- Modify: `package.json` (add `db:probe`)
- Test: `tests/unit/health-route.test.ts` (create)

**Interfaces:**
- Produces:
  - `pingDatabase(pool: { query(sql: string): Promise<unknown> }): Promise<void>`
  - `getDatabasePool(): Pool` from `composition.ts`
  - `GET /api/health` → `200 {"ok":true}` or `503 {"ok":false}`, both `Cache-Control: no-store`
  - `npm run db:probe` → exit 0 only when isolation, UTC, and `GET_LOCK` hold.
- Consumes: `databaseConfig("dev")`, `createDatabasePool` from Task 1.

- [ ] **Step 1: Write the failing test**

`tests/unit/health-route.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const pool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/server/composition", () => ({ getDatabasePool: () => pool }));

import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("answers ok when SELECT 1 succeeds", async () => {
    pool.query.mockResolvedValueOnce([{ 1: 1 }]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(pool.query).toHaveBeenCalledWith("SELECT 1");
  });

  it("answers 503 without leaking the error when the database is unreachable", async () => {
    pool.query.mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.1:3306"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/health-route.test.ts`
Expected: FAIL — cannot resolve `@/app/api/health/route` / `getDatabasePool` missing.

- [ ] **Step 3: Implement the health endpoint**

- `src/server/database-health.ts`: `pingDatabase` awaits `pool.query("SELECT 1")`; no try/catch.
- `src/server/composition.ts`: add `export function getDatabasePool(): Pool { return getPool(); }` next to `applicationServices`.
- `src/app/api/health/route.ts`: `export const dynamic = "force-dynamic";`; `GET` calls `pingDatabase(getDatabasePool())`; on success return `NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })`; on any error return the same body with status 503. Do not include the error text.

- [ ] **Step 4: Implement the session probe**

`scripts/db/probe-session.ts`:
- Build a pool with `createDatabasePool(databaseConfig("dev"))`.
- Using one `PoolConnection`:
  - read `SELECT @@version AS version, @@transaction_isolation AS isolation, @@session.time_zone AS tz`.
  - expect `isolation === "READ-COMMITTED"` and `tz === "+00:00"`.
  - `SELECT GET_LOCK('km_probe', 2) AS acquired` must be `1`.
  - `SELECT IS_USED_LOCK('km_probe') AS holder, CONNECTION_ID() AS id` must have `holder === id`.
  - `SELECT RELEASE_LOCK('km_probe') AS released` must be `1`.
- Release the connection, acquire a second one, and re-read isolation/time zone (proves `initSql` is applied to fresh connections).
- Print one `PASS`/`FAIL` line per check with the observed value; exit 1 if any check fails; always `pool.end()`.
- Add `"db:probe": "tsx scripts/db/probe-session.ts"` to `package.json`.

- [ ] **Step 5: Run the test and the probe**

Run: `npx vitest run --config vitest.config.ts tests/unit/health-route.test.ts` → PASS.
Run: `docker compose up -d --wait && npm run db:probe` → every check `PASS`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/server/database-health.ts src/app/api/health/route.ts src/server/composition.ts scripts/db/probe-session.ts package.json tests/unit/health-route.test.ts
git commit -m "feat(ops): add database health endpoint and session probe"
```

---

### Task 3: Optional site password

**Files:**
- Create: `src/lib/site-password.ts`
- Modify: `src/middleware.ts`
- Test: `tests/unit/site-password.test.ts` (create)

**Interfaces:**
- Produces:
  - `isSitePasswordExempt(pathname: string): boolean`
  - `verifySitePassword(authorization: string | null, password: string): Promise<boolean>`
  - `middleware(request: NextRequest): Promise<NextResponse>` (now async)
- Consumes: `KM_SITE_PASSWORD` from the environment.

- [ ] **Step 1: Write the failing tests**

`tests/unit/site-password.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { isSitePasswordExempt, verifySitePassword } from "@/lib/site-password";
import { middleware } from "@/middleware";

const basic = (value: string) => `Basic ${btoa(value)}`;

afterEach(() => vi.unstubAllEnvs());

describe("isSitePasswordExempt", () => {
  it.each(["/s", "/s/abc", "/s/abc/open", "/api/share-review", "/api/share-review/threads/query", "/api/health"])("exempts %s", (path) => {
    expect(isSitePasswordExempt(path)).toBe(true);
  });
  it.each(["/", "/w/ws/home", "/api/documents/x", "/sx", "/api/healthz"])("requires auth for %s", (path) => {
    expect(isSitePasswordExempt(path)).toBe(false);
  });
});

describe("verifySitePassword", () => {
  it("accepts the configured password with any username", async () => {
    expect(await verifySitePassword(basic("owner:s3cret"), "s3cret")).toBe(true);
  });
  it("rejects a wrong password, a missing header, and a non-Basic scheme", async () => {
    expect(await verifySitePassword(basic("owner:wrong"), "s3cret")).toBe(false);
    expect(await verifySitePassword(null, "s3cret")).toBe(false);
    expect(await verifySitePassword("Bearer s3cret", "s3cret")).toBe(false);
  });
  it("rejects malformed base64 without throwing", async () => {
    expect(await verifySitePassword("Basic !!!", "s3cret")).toBe(false);
  });
  it("handles a password containing a colon", async () => {
    expect(await verifySitePassword(basic("owner:a:b"), "a:b")).toBe(true);
  });
});

describe("middleware", () => {
  it("returns 401 with a Basic challenge when the password is set and absent", async () => {
    vi.stubEnv("KM_SITE_PASSWORD", "s3cret");
    const response = await middleware(new NextRequest("https://km.example.com/w/ws/home"));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('Basic realm="Knowledge Hub"');
  });

  it("lets an authenticated page through with its CSP header", async () => {
    vi.stubEnv("KM_SITE_PASSWORD", "s3cret");
    const response = await middleware(new NextRequest("https://km.example.com/w/ws/home", { headers: { authorization: basic("owner:s3cret") } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("script-src");
  });

  it("gates API routes but does not attach a page CSP to them", async () => {
    vi.stubEnv("KM_SITE_PASSWORD", "s3cret");
    const response = await middleware(new NextRequest("https://km.example.com/api/documents/x", { headers: { authorization: basic("owner:s3cret") } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  it("leaves everything alone when no password is configured", async () => {
    vi.stubEnv("KM_SITE_PASSWORD", "");
    const response = await middleware(new NextRequest("https://km.example.com/api/documents/x"));
    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/site-password.test.ts`
Expected: FAIL — module not found / middleware is not async.

- [ ] **Step 3: Implement the gate**

`src/lib/site-password.ts`:
- `isSitePasswordExempt`: exact `/s` and `/api/health`, prefixes `/s/`, `/api/share-review/`, and exact `/api/share-review`.
- `verifySitePassword`:
  - false for empty password or missing header;
  - split on the first space, require scheme `basic` case-insensitively;
  - `atob` in a try/catch;
  - split decoded value at the **first** `:`; username is ignored;
  - hash supplied and configured passwords with `crypto.subtle.digest("SHA-256", ...)` and compare with a length-aware constant-time loop (no early return).
- `src/middleware.ts`:
  - make the function `async`;
  - read `process.env.KM_SITE_PASSWORD`; when set and the path is not exempt, return `new NextResponse("Authentication required.", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Knowledge Hub", charset="UTF-8"', "Cache-Control": "no-store" } })` unless `verifySitePassword` passes;
  - after auth, if `pathname.startsWith("/api/")`, `return NextResponse.next()` (no CSP; `next.config.ts` supplies the static header);
  - keep the existing nonce/CSP logic for pages unchanged.
- Matcher becomes `["/((?!_next/static|_next/image|icon.svg|icons/).*)"]`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --config vitest.config.ts tests/unit/site-password.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/site-password.ts src/middleware.ts tests/unit/site-password.test.ts
git commit -m "feat(auth): add opt-in site password gate"
```

---

### Task 4: Folder-import batch ceiling for Vercel

**Files:**
- Modify: `src/components/imports/folder-import-form.tsx`
- Test: `tests/unit/import-upload-batch.test.ts` (create)

**Interfaces:**
- Produces: `export const MAX_UPLOAD_BATCH_BYTES = 4 * 1024 * 1024` from `folder-import-form.tsx`, used by `uploadMarkdownBatches`.
- Consumes: existing `runFolderImport` contract.

- [ ] **Step 1: Write the failing test**

`tests/unit/import-upload-batch.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_UPLOAD_BATCH_BYTES, runFolderImport } from "@/components/imports/folder-import-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/source-import-scope", () => ({ loadSourceImportScope: vi.fn(async () => ({ paths: [], configured: true, syncVersion: 1 })) }));
vi.mock("@/components/shell/use-workspace-authorization", () => ({
  requestWorkspaceAccessCheck: vi.fn(),
  useWorkspaceAuthorization: () => ({ access: { actions: { canImport: true } }, confirmed: true }),
}));

afterEach(() => vi.restoreAllMocks());

function markdown(size: number, name: string): File {
  return new File(["a".repeat(size)], name, { type: "text/markdown" });
}

describe("folder-import upload batches", () => {
  it("keeps batches at or below the Vercel-safe ceiling", async () => {
    const files = [markdown(3 * 1024 * 1024, "a.md"), markdown(2 * 1024 * 1024, "b.md")];
    const batches: number[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/entries")) {
        const form = init?.body as FormData;
        let total = 0;
        form.forEach((value, key) => { if (key.startsWith("file-")) total += (value as File).size; });
        batches.push(total);
        return Response.json({});
      }
      if (url.includes("/source-imports") && !url.endsWith("/finalize")) return Response.json({ snapshotId: "snap-1" }, { status: 201 });
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await runFolderImport({ target: { kind: "new", workspaceId: "w1" }, files, sourceName: "Notes", onProgress: () => {} });

    expect(MAX_UPLOAD_BATCH_BYTES).toBe(4 * 1024 * 1024);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toBe(3 * 1024 * 1024);
    expect(batches[1]).toBe(2 * 1024 * 1024);
    for (const total of batches) expect(total).toBeLessThanOrEqual(MAX_UPLOAD_BATCH_BYTES);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/import-upload-batch.test.ts`
Expected: FAIL — `MAX_UPLOAD_BATCH_BYTES` is not exported.

- [ ] **Step 3: Lower the constant**

In `folder-import-form.tsx`, replace `const MAX_BATCH_BYTES = 10 * 1024 * 1024;` with:

```ts
// Vercel caps a Function request body at 4.5 MB; 4 MiB of files plus multipart
// headers stays below it. Local builds use the same ceiling so behaviour is identical.
export const MAX_UPLOAD_BATCH_BYTES = 4 * 1024 * 1024;
```

Use `MAX_UPLOAD_BATCH_BYTES` in `uploadMarkdownBatches`. Do not change the 20-file cap.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --config vitest.config.ts tests/unit/import-upload-batch.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the existing import UI tests**

Run: `npx vitest run --config vitest.config.ts tests/unit/folder-import-form.test.tsx tests/unit/folder-import-form-lifecycle.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/imports/folder-import-form.tsx tests/unit/import-upload-batch.test.ts
git commit -m "fix(import): cap upload batches at 4 MiB for Vercel"
```

---

### Task 5: Vercel build, ignore, and project configuration

**Files:**
- Create: `scripts/vercel-build.mjs`
- Create: `scripts/vercel-ignore.mjs`
- Create: `vercel.json`
- Create: `.vercelignore`
- Modify: `package.json` (scripts, `engines.node`)
- Test: `tests/unit/vercel-scripts.test.ts` (create)

**Interfaces:**
- Produces:
  - `node scripts/vercel-build.mjs` — builds, then migrates in production.
  - `node scripts/vercel-build.mjs --dry-run` — prints one JSON line `{"build":true,"migrate":boolean,"migrationUrlSource":"direct"|"app"|"none"}` and exits 1 when migration is required but no URL exists.
  - `node scripts/vercel-ignore.mjs` — exit 0 to skip, 1 to build.
- Consumes: `KM_DB_MIGRATE_URL`, `KM_DB_URL`, `KM_MIGRATE_ON_BUILD`, `VERCEL_ENV`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/vercel-scripts.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function run(script: string, args: string[] = [], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...env },
  });
  return { status: result.status, stdout: result.stdout.trim() };
}

describe("vercel-ignore.mjs", () => {
  it("skips preview and development builds", () => {
    expect(run("scripts/vercel-ignore.mjs", [], { VERCEL_ENV: "preview" }).status).toBe(0);
    expect(run("scripts/vercel-ignore.mjs", [], { VERCEL_ENV: "development" }).status).toBe(0);
  });
  it("builds production and unset environments", () => {
    expect(run("scripts/vercel-ignore.mjs", [], { VERCEL_ENV: "production" }).status).toBe(1);
    expect(run("scripts/vercel-ignore.mjs").status).toBe(1);
  });
});

describe("vercel-build.mjs --dry-run", () => {
  it("migrates in production when a direct URL is available", () => {
    const result = run("scripts/vercel-build.mjs", ["--dry-run"], {
      VERCEL_ENV: "production", KM_DB_MIGRATE_URL: "mysql://direct/db", KM_DB_URL: "mysql://pooled/db",
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ build: true, migrate: true, migrationUrlSource: "direct" });
  });
  it("skips migrations outside production or when disabled", () => {
    expect(JSON.parse(run("scripts/vercel-build.mjs", ["--dry-run"], { VERCEL_ENV: "preview", KM_DB_URL: "mysql://pooled/db" }).stdout)).toMatchObject({ migrate: false });
    expect(JSON.parse(run("scripts/vercel-build.mjs", ["--dry-run"], { VERCEL_ENV: "production", KM_MIGRATE_ON_BUILD: "0", KM_DB_URL: "mysql://pooled/db" }).stdout)).toMatchObject({ migrate: false });
  });
  it("fails when production migration has no URL", () => {
    expect(run("scripts/vercel-build.mjs", ["--dry-run"], { VERCEL_ENV: "production" }).status).toBe(1);
  });
});

describe("vercel.json", () => {
  it("builds through the migration-aware script and targets sin1", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(config).toMatchObject({
      framework: "nextjs",
      installCommand: "npm ci",
      buildCommand: "node scripts/vercel-build.mjs",
      ignoreCommand: "node scripts/vercel-ignore.mjs",
      regions: ["sin1"],
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/vercel-scripts.test.ts`
Expected: FAIL — scripts and `vercel.json` do not exist.

- [ ] **Step 3: Implement the scripts and config**

- `scripts/vercel-ignore.mjs`: read `process.env.VERCEL_ENV`; if set and not `production`, log `vercel-ignore: <env>; skipping build.` and `process.exit(0)`; otherwise log and `process.exit(1)`.
- `scripts/vercel-build.mjs`:
  - `const isProduction = process.env.VERCEL_ENV === "production";`
  - `const migrate = isProduction && process.env.KM_MIGRATE_ON_BUILD !== "0";`
  - `const migrateUrl = (process.env.KM_DB_MIGRATE_URL ?? "").trim() || (process.env.KM_DB_URL ?? "").trim();`
  - `--dry-run` prints `JSON.stringify({ build: true, migrate, migrationUrlSource: direct ? "direct" : app ? "app" : "none" })` and exits `migrate && !migrateUrl ? 1 : 0`.
  - Otherwise: run `node scripts/build.mjs`; on failure exit with its status; when `migrate`, fail with a clear message if no URL, warn when falling back to `KM_DB_URL`, then run `npm run db:migrate` with `env: { ...process.env, KM_DB_URL: migrateUrl }`; when not migrating, log the reason. Never print `migrateUrl`.
- `vercel.json` exactly as in the test plus `"$schema": "https://openapi.vercel.sh/vercel.json"`.
- `.vercelignore`: `.next`, `.next-dev`, `playwright-report`, `test-results`, `*.tsbuildinfo`, `.impeccable`, `work`.
- `package.json`: add `"build:vercel": "node scripts/vercel-build.mjs"` and change `engines.node` to `"24.x"`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --config vitest.config.ts tests/unit/vercel-scripts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/vercel-build.mjs scripts/vercel-ignore.mjs vercel.json .vercelignore package.json tests/unit/vercel-scripts.test.ts
git commit -m "feat(deploy): add Vercel build, migration, and preview policy"
```

---

### Task 6: Environment template and deployment runbook

**Files:**
- Modify: `.env.example`
- Create: `docs/operations/vercel-layerbase.md`
- Modify: `README.md` (add a Deployment section with a link)

**Interfaces:**
- Produces the exact operator steps; no code interfaces.

- [ ] **Step 1: Add the commented environment template**

Append to `.env.example`:

```dotenv
# --- Deployed: Vercel + Layerbase (Production scope only) ---
# Prefer KM_DB_URL over the individual KM_DB_* values above.
# KM_DB_URL="mysql://USER:PASSWORD@HOST:PORT/DATABASE"      # pooled URL at runtime
# KM_DB_SSL=verify
# KM_DB_POOL_SIZE=2
# KM_DB_CONNECT_TIMEOUT_MS=30000
# KM_DB_ACQUIRE_TIMEOUT_MS=35000
# KM_DB_MIGRATE_URL="mysql://USER:PASSWORD@DIRECT_HOST:PORT/DATABASE"   # direct URL, build-only
# KM_MIGRATE_ON_BUILD=1
# KM_IMPORT_MAX_UPLOAD_BATCH_BYTES=4194304
# KM_IMPORT_MAX_MARKDOWN_FILE_BYTES=4000000

# Single-operator production identity. Never use these on a shared deployment.
# KM_IDENTITY_PROVIDER=local
# KM_LOCAL_IDENTITY_ENABLED=true
# KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION=true
# KM_PUBLIC_ORIGIN=https://your-project.vercel.app
# KM_SITE_PASSWORD=choose-a-long-unique-password
```

- [ ] **Step 2: Write the operations runbook**

`docs/operations/vercel-layerbase.md` must contain, in order:

1. Create a Layerbase MariaDB **10.11** database; copy both the **pooled** and **direct** connection strings.
2. `vercel login` and `vercel link` (or connect `mike840609/knowledge-hub` in the Vercel dashboard). Set the Production branch to `main`.
3. Set Production environment variables: every runtime variable from the design §8, plus build-only `KM_DB_MIGRATE_URL`. Note that previews are disabled by `scripts/vercel-ignore.mjs`.
4. Run `KM_DB_URL="<direct>" npm run db:probe`. If isolation, `GET_LOCK`, or UTC fails, set the runtime `KM_DB_URL` to the direct string instead of the pooled one, and record that.
5. Data: fresh (`KM_DB_URL="<direct>" npm run db:migrate && KM_DB_URL="<direct>" npm run db:seed`) **or** copy local data:
   ```sh
   docker compose exec -T mariadb mysqldump -uroot -phcm_km_root --single-transaction --routines --triggers hcm_km_dev > km-local.sql
   mysql --ssl-mode=REQUIRED -h <host> -P <port> -u <user> -p <database> < km-local.sql
   ```
   The dump includes `schema_migrations`; identity IDs must match the `KM_LOCAL_*` values.
6. Deploy with `vercel --prod` or a push to `main`; confirm the build log shows `next build` first and then the migration.
7. Smoke tests: `curl https://<domain>/api/health`, open `/`, create/edit a document, open a share link in a private window, post a review reply, import a small folder.
8. Troubleshooting: cold wake up to 30 s; free plan 20-connection cap (raise the plan or lower `KM_DB_POOL_SIZE`); TLS verification failure (`KM_DB_SSL=trust` only after confirming the host); migration ledger `FAILED` (repair explicitly, never edit checksums); 413 from imports (files must stay under 4 MiB each; lower `KM_IMPORT_MAX_MANIFEST_ENTRIES` if a manifest itself exceeds 4.5 MB); export/document responses over 4.5 MB fail on Vercel.

- [ ] **Step 3: Link it from the README**

Add a short `## Deployment` section near the other operations links, pointing at `docs/operations/vercel-layerbase.md`.

- [ ] **Step 4: Verify the docs are wired**

Run: `rg -n "vercel-layerbase" README.md && rg -n "KM_DB_MIGRATE_URL|KM_SITE_PASSWORD" .env.example docs/operations/vercel-layerbase.md`
Expected: both commands print matches.

- [ ] **Step 5: Commit**

```bash
git add .env.example docs/operations/vercel-layerbase.md README.md
git commit -m "docs(deploy): document Vercel + Layerbase deployment"
```

---

### Task 7: Full local verification and deploy handoff

**Files:**
- No source changes unless a check fails.

- [ ] **Step 1: Run the DB-free gate**

```sh
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

Expected: all exit 0. `npm run build` must still succeed with no database reachable.

- [ ] **Step 2: Run the local integration suite against MariaDB**

```sh
docker compose up -d --wait
npm run test:integration
```

Expected: PASS with the local MariaDB 10.11 container. These suites exercise the new `initSql` and pool settings.

- [ ] **Step 3: Run the session probe locally**

```sh
npm run db:probe
```

Expected: every check passes, including `READ-COMMITTED`, `+00:00`, and the `GET_LOCK` holder equal to `CONNECTION_ID()`.

- [ ] **Step 4: Deployer-only steps (report, do not guess)**

These require the user's Layerbase account and Vercel login, which are not available in this session:

- Create the Layerbase MariaDB 10.11 database and copy both URLs.
- Run `npm run db:probe` against it and choose pooled vs direct for `KM_DB_URL`.
- Set the Vercel Production variables and `KM_DB_MIGRATE_URL`.
- Run the data path (seed or local dump).
- Deploy, then run the smoke tests and a cold-start check from the runbook.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore(deploy): verify Vercel + Layerbase readiness"
```

Only commit if Step 4 produced repo changes; otherwise this step is a no-op.

---

## Plan self-review

- **Spec coverage:** connection URL/TLS/pool (§1–2) → Task 1; migrations (§3) and previews (§7) → Task 5; probe (§4) → Task 2; health (§5) → Task 2; site password (§6) → Task 3; Vercel config (§7) → Task 5; env (§8) → Tasks 5–6; platform limits (§9) → Task 4 and Task 6; data bootstrap and docs (§10–11) → Task 6; verification → Task 7.
- **Types:** `getDatabasePool`, `pingDatabase`, `MAX_UPLOAD_BATCH_BYTES`, `parseConnectionUrl`, `sslOption`, and `SESSION_INIT_SQL` are defined once and used with the same names in later tasks.
- **Review Focus tests:** URL edge cases → Task 1; session loss → Task 2 probe; share-link exemption and API gating → Task 3; cold wake → Task 2 health test + Task 7 manual check; 4 MiB boundary → Task 4; preview/migration policy → Task 5.
