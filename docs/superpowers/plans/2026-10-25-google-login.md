# Google Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google sign-in to the demo deployment, with an auto-generated `emp_id`, without changing the existing `local` or `company-sso` providers.

**Architecture:** Auth.js v5 with JWT sessions. An Edge-safe `auth.config.ts` is used by middleware; a Node-only `auth.ts` adds the database-backed `jwt` callback. Google users are resolved through the existing `HubIdentityResolver` into the existing `users` and `external_identity_links` tables, so there is no schema migration. Middleware keeps the existing CSP and site-password code, and adds the Google session gate only when `KM_IDENTITY_PROVIDER=google`.

**Tech Stack:** Next.js 15.5, React 19, TypeScript, `next-auth@5.0.0-beta.32`, MariaDB, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-25-google-login-design.md`

## Global Constraints

- Do not change the behaviour of `local` or `company-sso`. Google is selected only by
  `KM_IDENTITY_PROVIDER=google`.
- No database migration. Use `users` and `external_identity_links` as they exist.
- `emp_id = DEMO-<10 uppercase hex of SHA-256(google subject)>`; `org_code = DEMO`.
- Display name: Google profile name → email local-part → `Demo user`; trim and cap at 512.
- `emp_id` is not shown in the shell; the bottom-left shows the display name with the generic user
  icon. No Google profile picture is stored.
- Public paths under Google: `/login`, `/api/auth/*`, `/api/health`, `/api/share-review/*`,
  `/sample-wiki/*`, `/s`, and `/s/<token>`. `/s/<token>/open` is protected.
- `returnTo` accepts only `/`, `/w/...`, and `/s/...`; reject `//`, `..`, and absolute URLs.
- Edge middleware must never import `mariadb` or the Node-only `auth.ts`.
- Google configuration fails the production build when `AUTH_SECRET`, `AUTH_GOOGLE_ID`,
  `AUTH_GOOGLE_SECRET`, `AUTH_URL`, or `KM_PUBLIC_ORIGIN` is missing, or when the two origins differ.
- `KM_REVIEW_WRITES_ENABLED=true` for the demo; anonymous writes remain 401.
- Pin `next-auth@5.0.0-beta.32`; add no other runtime dependencies.

## Review Focus

- A deployment with `KM_IDENTITY_PROVIDER=local` or `company-sso` must never instantiate Auth.js,
  require `AUTH_*`, or change its middleware decisions. Existing tests must pass unchanged.
- The Edge bundle must not pull `mariadb`; only `auth.config.ts` may be imported by middleware.
- A first Google sign-in creates exactly one Hub user and one `(google, subject)` link; a second
  sign-in reuses them, and a changed Google name updates `users.name`.
- A signed-out visitor gets a redirect for pages and a JSON 401 for APIs; share pages, share-review
  APIs, health, and auth endpoints remain public.
- `/` with `?returnTo=/s/<token>` preserves that destination through login; `/s/<token>/open`
  sends a signed-out visitor to `/login?returnTo=/s/<token>/open`.
- `returnTo` cannot be used as an open redirect.
- The build fails, before `next build`, on a missing or mismatched Google auth configuration.

---

### Task 1: Pool extraction and Google identity resolution

**Files:**
- Create: `src/server/database-pool.ts`
- Modify: `src/server/composition.ts`
- Create: `src/server/google-identity.ts`
- Test: `tests/unit/google-identity.test.ts` (create)
- Test: `tests/integration/google-identity.test.ts` (create)

**Interfaces:**
- Produces:
  - `getDatabasePool(): Pool` and `closeDatabasePool(): Promise<void>` from `database-pool.ts`.
  - `googleEmpId(subject: string): string`
  - `googleDisplayName(name: string, email: string): string`
  - `resolveGoogleIdentity(input: { subject: string; name: string; email: string }, unitOfWork?: HubIdentityUnitOfWork): Promise<UserIdentity>`
- Consumes: `databaseConfig`, `createDatabasePool`, `MariaDbUnitOfWork`, `HubIdentityResolver`.
- Composition re-exports `getDatabasePool` so the health route and its tests keep their import.

- [ ] **Step 1: Write the failing unit tests**

`tests/unit/google-identity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { googleDisplayName, googleEmpId } from "@/server/google-identity";

describe("googleEmpId", () => {
  it("is deterministic, prefixed, and unique per subject", () => {
    const first = googleEmpId("google-subject-1");
    expect(first).toMatch(/^DEMO-[0-9A-F]{10}$/);
    expect(googleEmpId("google-subject-1")).toBe(first);
    expect(googleEmpId("google-subject-2")).not.toBe(first);
  });
});

describe("googleDisplayName", () => {
  it("uses the trimmed Google name first", () => {
    expect(googleDisplayName("  Wang Xiaoming  ", "wm@example.com")).toBe("Wang Xiaoming");
  });
  it("falls back to the email local-part", () => {
    expect(googleDisplayName("", "wm@example.com")).toBe("wm");
  });
  it("falls back to Demo user and caps at 512 characters", () => {
    expect(googleDisplayName("", "")).toBe("Demo user");
    expect(googleDisplayName("x".repeat(600), "a@example.com")).toHaveLength(512);
  });
});
```

- [ ] **Step 2: Run the unit tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/google-identity.test.ts`
Expected: FAIL — `@/server/google-identity` does not exist.

- [ ] **Step 3: Write the failing integration test**

Follow the pool setup in `tests/integration/phase3-identity-resolution.test.ts`. Use the test database
from `databaseConfig("test")` and a unique Google subject.

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { HubIdentityResolver } from "@/modules/identity/application/hub-identity-resolver";
import { resolveGoogleIdentity } from "@/server/google-identity";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

describe("resolveGoogleIdentity", () => {
  it("creates one user and one link, then reuses them and updates the name", async () => {
    const subject = `google-${Date.now()}-${Math.random()}`;
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const first = await resolveGoogleIdentity({ subject, name: "First Name", email: "first@example.com" }, unitOfWork);
    expect(first.emp_id).toMatch(/^DEMO-[0-9A-F]{10}$/);
    expect(first.org_code).toBe("DEMO");
    const second = await resolveGoogleIdentity({ subject, name: "Updated Name", email: "first@example.com" }, unitOfWork);
    expect(second.id).toBe(first.id);
    expect(second.emp_id).toBe(first.emp_id);
    expect(second.name).toBe("Updated Name");
    const links = await new MariaDbUnitOfWork(pool).run((repos) => repos.identityLinks.findByProviderSubject("google", subject));
    expect(links?.hubUserId).toBe(first.id);
  });
});
```

- [ ] **Step 4: Run the integration test to verify it fails**

Run: `npm run test:integration` (the full suite; the new file runs inside it).
Expected: FAIL — the module does not exist.

- [ ] **Step 5: Implement the pool extraction**

Move the `globalThis` pool slot from `composition.ts` into `src/server/database-pool.ts`:

```ts
type GlobalPoolSlot = { __kmDbPool?: Pool };
export function getDatabasePool(): Pool { /* same HMR comment and pinning */ }
export async function closeDatabasePool(): Promise<void> { /* end and delete the slot */ }
```

In `composition.ts`: import `getDatabasePool` and `closeDatabasePool`; use `getDatabasePool()` in
`applicationServices`, `shareReadService`, and `reviewReadService`; re-export
`export { getDatabasePool } from "./database-pool";`; `closeApplicationPool` calls
`closeDatabasePool()` and then clears `services`/`companySessionReader`. Remove the local
`GlobalPoolSlot`/`getPool`.

- [ ] **Step 6: Implement `src/server/google-identity.ts`**

```ts
import { createHash } from "node:crypto";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { HubIdentityResolver, type HubIdentityUnitOfWork } from "@/modules/identity/application/hub-identity-resolver";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { getDatabasePool } from "./database-pool";

export function googleEmpId(subject: string): string {
  return `DEMO-${createHash("sha256").update(subject).digest("hex").slice(0, 10).toUpperCase()}`;
}

export function googleDisplayName(name: string, email: string): string {
  const value = name.trim() || email.split("@")[0]?.trim() || "Demo user";
  return value.slice(0, 512);
}

export async function resolveGoogleIdentity(
  input: { subject: string; name: string; email: string },
  unitOfWork: HubIdentityUnitOfWork = new MariaDbUnitOfWork(getDatabasePool()),
): Promise<UserIdentity> {
  if (!input.subject) throw new Error("Google subject is required.");
  const resolver = new HubIdentityResolver(unitOfWork);
  return resolver.resolve({
    provider: "google",
    subject: input.subject,
    emp_id: googleEmpId(input.subject),
    name: googleDisplayName(input.name, input.email),
    org_code: "DEMO",
  });
}
```

- [ ] **Step 7: Run the unit and integration tests**

Run the unit test, then the integration test with a running MariaDB.
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server/database-pool.ts src/server/composition.ts src/server/google-identity.ts tests/unit/google-identity.test.ts tests/integration/google-identity.test.ts
git commit -m "feat(auth): resolve Google identities through the existing identity links"
```

---

### Task 2: Auth.js configuration, route, and build-time env validation

**Files:**
- Modify: `package.json` / `package-lock.json` (add `next-auth@5.0.0-beta.32`)
- Create: `src/auth.config.ts`
- Create: `src/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/types/next-auth.d.ts`
- Modify: `scripts/vercel-build.mjs`
- Test: `tests/unit/vercel-scripts.test.ts` (extend)

**Interfaces:**
- Produces: `authConfig`, `handlers`, `auth`, `signIn`, `signOut`.
- `authConfig` is Edge-safe: Google provider, JWT session (7 days), `pages.signIn = "/login"`.
- `auth.ts` adds `jwt`/`session` callbacks that call `resolveGoogleIdentity` and store
  `hubUserId`, `empId`, `orgCode`, `displayName` on the token/session.

- [ ] **Step 1: Write the failing build-policy tests**

Extend `tests/unit/vercel-scripts.test.ts`:

```ts
it("validates Google auth env only when that provider is selected", () => {
  const local = JSON.parse(run("scripts/vercel-build.mjs", ["--dry-run"], { KM_IDENTITY_PROVIDER: "local" }).stdout);
  expect(local.authErrors).toEqual([]);

  const missing = run("scripts/vercel-build.mjs", ["--dry-run"], { KM_IDENTITY_PROVIDER: "google" });
  expect(missing.status).toBe(1);
  expect(JSON.parse(missing.stdout).authErrors).toEqual(expect.arrayContaining(["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"]));

  const complete = run("scripts/vercel-build.mjs", ["--dry-run"], {
    KM_IDENTITY_PROVIDER: "google",
    AUTH_SECRET: "secret", AUTH_GOOGLE_ID: "id", AUTH_GOOGLE_SECRET: "google-secret",
    AUTH_URL: "https://km.example.com", KM_PUBLIC_ORIGIN: "https://km.example.com",
  });
  expect(complete.status).toBe(0);
  expect(JSON.parse(complete.stdout).authErrors).toEqual([]);
});

it("rejects a mismatched AUTH_URL and KM_PUBLIC_ORIGIN", () => {
  const result = run("scripts/vercel-build.mjs", ["--dry-run"], {
    KM_IDENTITY_PROVIDER: "google",
    AUTH_SECRET: "secret", AUTH_GOOGLE_ID: "id", AUTH_GOOGLE_SECRET: "google-secret",
    AUTH_URL: "https://a.example.com", KM_PUBLIC_ORIGIN: "https://b.example.com",
  });
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout).authErrors).toContain("AUTH_URL must match KM_PUBLIC_ORIGIN");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/vercel-scripts.test.ts`
Expected: FAIL — the dry-run output has no `authErrors` and the missing-env case exits 0.

- [ ] **Step 3: Implement the build validation**

At the top of `scripts/vercel-build.mjs`, compute:

```js
const identityProvider = process.env.KM_IDENTITY_PROVIDER ?? "local";
function googleAuthErrors() {
  if (identityProvider !== "google") return [];
  const errors = [];
  for (const name of ["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "AUTH_URL", "KM_PUBLIC_ORIGIN"]) {
    if (!(process.env[name] ?? "").trim()) errors.push(name);
  }
  const authUrl = (process.env.AUTH_URL ?? "").trim();
  const publicOrigin = (process.env.KM_PUBLIC_ORIGIN ?? "").trim();
  if (authUrl && publicOrigin) {
    try {
      if (new URL(authUrl).origin !== new URL(publicOrigin).origin) errors.push("AUTH_URL must match KM_PUBLIC_ORIGIN");
    } catch {
      errors.push("AUTH_URL and KM_PUBLIC_ORIGIN must be absolute URLs");
    }
  }
  return errors;
}
const authErrors = googleAuthErrors();
```

Include `authProvider` and `authErrors` in the `--dry-run` JSON; exit 1 when `authErrors` is
non-empty. Before `next build`, print the errors and exit 1. This runs only in the build script;
`local`/`company-sso` see no change.

- [ ] **Step 4: Install and configure Auth.js**

Run: `npm install next-auth@5.0.0-beta.32`.

`src/auth.config.ts`:

```ts
import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

export const authConfig = {
  providers: [Google],
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
} satisfies NextAuthConfig;
```

`src/auth.ts`:

```ts
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { resolveGoogleIdentity } from "@/server/google-identity";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account?.provider === "google" && typeof profile?.sub === "string") {
        const identity = await resolveGoogleIdentity({
          subject: profile.sub,
          name: typeof profile.name === "string" ? profile.name : "",
          email: typeof profile.email === "string" ? profile.email : "",
        });
        token.hubUserId = identity.id;
        token.empId = identity.emp_id;
        token.orgCode = identity.org_code;
        token.displayName = identity.name;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.hubUserId = String(token.hubUserId ?? "");
        session.user.empId = String(token.empId ?? "");
        session.user.orgCode = String(token.orgCode ?? "");
        session.user.displayName = String(token.displayName ?? "");
      }
      return session;
    },
  },
});
```

`src/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from "@/auth";
export const { GET, POST } = handlers;
```

`src/types/next-auth.d.ts` augments `Session.user` and `JWT` with the four fields.

- [ ] **Step 5: Run the policy tests and typecheck**

Run: `npx vitest run --config vitest.config.ts tests/unit/vercel-scripts.test.ts`
Run: `npm run typecheck`
Expected: PASS. If `next-auth`'s types require a different session field shape, fix the augmentation,
not the callbacks.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/auth.config.ts src/auth.ts src/app/api/auth/\[...nextauth\]/route.ts src/types/next-auth.d.ts scripts/vercel-build.mjs tests/unit/vercel-scripts.test.ts
git commit -m "feat(auth): add Auth.js Google configuration and build checks"
```

---

### Task 3: Google identity provider, factory, and trusted caller

**Files:**
- Create: `src/infrastructure/identity/google-identity-provider.ts`
- Modify: `src/server/config.ts`
- Modify: `src/server/identity-provider-factory.ts`
- Modify: `src/server/trusted-caller.ts`
- Test: `tests/unit/google-identity-provider.test.ts` (create)
- Test: `tests/unit/phase3-identity-provider.test.ts` (extend)
- Test: `tests/unit/trusted-caller-google.test.ts` (create)

**Interfaces:**
- `GOOGLE_IDENTITY_PROVIDER_NAME = "google"`.
- `GoogleIdentityProvider.getCurrentIdentity()` reads `auth()`; throws `AuthRequiredError` without
  a session.
- `identityProviderKind()` accepts `"local" | "company-sso" | "google"`.
- `createIdentityProvider` returns the Google provider only for `"google"` and fails fast without
  `AUTH_SECRET`, `AUTH_GOOGLE_ID`, or `AUTH_GOOGLE_SECRET`.
- `establishTrustedCaller` uses direct identity for `local` **and** `google`; company SSO still uses
  `HubIdentityResolver`.

- [ ] **Step 1: Write the failing provider tests**

`tests/unit/google-identity-provider.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth }));

import { GoogleIdentityProvider } from "@/infrastructure/identity/google-identity-provider";
import { AuthRequiredError } from "@/modules/identity/domain/identity-session-errors";

beforeEach(() => auth.mockReset());

describe("GoogleIdentityProvider", () => {
  it("maps the Auth.js session to the Hub identity", async () => {
    auth.mockResolvedValue({ user: { hubUserId: "u1", empId: "DEMO-ABC1234567", displayName: "Wang", orgCode: "DEMO" } });
    await expect(new GoogleIdentityProvider().getCurrentIdentity()).resolves.toEqual({
      id: "u1", emp_id: "DEMO-ABC1234567", name: "Wang", org_code: "DEMO",
    });
  });
  it("throws AuthRequiredError without a session", async () => {
    auth.mockResolvedValue(null);
    await expect(new GoogleIdentityProvider().getCurrentIdentity()).rejects.toBeInstanceOf(AuthRequiredError);
  });
});
```

- [ ] **Step 2: Run the provider test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/google-identity-provider.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the provider**

```ts
export const GOOGLE_IDENTITY_PROVIDER_NAME = "google";

export class GoogleIdentityProvider implements IdentityProvider {
  async getCurrentIdentity(): Promise<UserIdentity> {
    const session = await auth();
    const user = session?.user;
    if (!user?.hubUserId) throw new AuthRequiredError();
    return validateUserIdentity({ id: user.hubUserId, emp_id: user.empId, name: user.displayName, org_code: user.orgCode });
  }

  async getCurrentClaims(): Promise<TrustedIdentityClaims> {
    const identity = await this.getCurrentIdentity();
    return {
      externalIdentity: { provider: GOOGLE_IDENTITY_PROVIDER_NAME, subject: identity.id, emp_id: identity.emp_id, name: identity.name, org_code: identity.org_code },
      validatedExternalGroupIds: [],
      platformCapabilities: [],
      refreshedAt: new Date(),
    };
  }
}
```

- [ ] **Step 4: Extend the factory and trusted caller**

`identityProviderKind()` union adds `"google"`. `createIdentityProvider` adds a branch before the
production local guard:

```ts
if (kind === "google") {
  for (const name of ["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"]) {
    if (!(process.env[name] ?? "").trim()) throw new IdentityError(`Google identity requires ${name}.`);
  }
  return new GoogleIdentityProvider();
}
```

`establishTrustedCaller`:

```ts
const direct = claims.externalIdentity.provider === LOCAL_IDENTITY_PROVIDER_NAME
  || claims.externalIdentity.provider === GOOGLE_IDENTITY_PROVIDER_NAME;
const identity = direct ? await dependencies.provider.getCurrentIdentity() : await dependencies.resolver.resolve(claims.externalIdentity);
```

- [ ] **Step 5: Add the factory/trusted-caller tests**

Extend `phase3-identity-provider.test.ts` with Google env cases (accept, missing env throws) and add
`trusted-caller-google.test.ts` proving a Google principal calls `getCurrentIdentity` and never
`resolver.resolve`, while a company-SSO principal still calls the resolver.

- [ ] **Step 6: Run the provider, factory, and trusted-caller tests**

Run: `npx vitest run --config vitest.config.ts tests/unit/google-identity-provider.test.ts tests/unit/phase3-identity-provider.test.ts tests/unit/trusted-caller-google.test.ts`
Expected: PASS. Run the existing identity/trusted-caller suite to prove local/company-sso are unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/infrastructure/identity/google-identity-provider.ts src/server/config.ts src/server/identity-provider-factory.ts src/server/trusted-caller.ts tests/unit/google-identity-provider.test.ts tests/unit/phase3-identity-provider.test.ts tests/unit/trusted-caller-google.test.ts
git commit -m "feat(auth): add the Google identity provider without touching existing providers"
```

---

### Task 4: Middleware Google gate and safe return paths

**Files:**
- Create: `src/lib/auth-paths.ts`
- Modify: `src/middleware.ts`
- Test: `tests/unit/auth-paths.test.ts` (create)
- Test: `tests/unit/site-password.test.ts` (must keep passing unchanged)

**Interfaces:**
- `isGooglePublicPath(pathname: string): boolean`
- `safeReturnTo(value: string | null | undefined): string`
- `googleGate(input: { pathname: string; search: string; hasSession: boolean }): { kind: "allow" } | { kind: "unauthorized" } | { kind: "redirect"; location: string }`

- [ ] **Step 1: Write the failing auth-path tests**

```ts
import { describe, expect, it } from "vitest";
import { googleGate, isGooglePublicPath, safeReturnTo } from "@/lib/auth-paths";

describe("isGooglePublicPath", () => {
  it.each(["/login", "/api/auth/callback/google", "/api/health", "/api/share-review/threads/x", "/sample-wiki/manifest.json", "/s", "/s/token"])("is public: %s", (path) => {
    expect(isGooglePublicPath(path)).toBe(true);
  });
  it.each(["/", "/w/ws/home", "/api/documents/x", "/s/token/open"])("is protected: %s", (path) => {
    expect(isGooglePublicPath(path)).toBe(false);
  });
});

describe("safeReturnTo", () => {
  it.each(["/", "/w/ws/home", "/s/token", "/s/token/open"])("accepts %s", (value) => {
    expect(safeReturnTo(value)).toBe(value);
  });
  it.each([null, "", "https://evil.example", "//evil.example", "/w/../admin", "/login"])("falls back to / for %s", (value) => {
    expect(safeReturnTo(value)).toBe("/");
  });
});

describe("googleGate", () => {
  it("allows public paths without a session", () => {
    expect(googleGate({ pathname: "/s/token", search: "", hasSession: false })).toEqual({ kind: "allow" });
  });
  it("returns 401 for protected APIs without a session", () => {
    expect(googleGate({ pathname: "/api/documents/x", search: "", hasSession: false })).toEqual({ kind: "unauthorized" });
  });
  it("redirects a protected page, preserving a safe /s returnTo", () => {
    expect(googleGate({ pathname: "/", search: "?returnTo=/s/token", hasSession: false })).toEqual({
      kind: "redirect", location: "/login?returnTo=%2Fs%2Ftoken",
    });
    expect(googleGate({ pathname: "/s/token/open", search: "", hasSession: false })).toEqual({
      kind: "redirect", location: "/login?returnTo=%2Fs%2Ftoken%2Fopen",
    });
  });
  it("allows a session through", () => {
    expect(googleGate({ pathname: "/w/ws/home", search: "", hasSession: true })).toEqual({ kind: "allow" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/auth-paths.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `src/lib/auth-paths.ts`**

- Public exact: `/login`, `/api/health`, `/s`.
- Public prefixes: `/api/auth/`, `/api/share-review/`, `/sample-wiki/`.
- Public shared read: `^/s/[A-Za-z0-9_-]{1,128}$` (must not match `/open`).
- `safeReturnTo`: `/` or `/w/...` or `/s/...`; reject `//`, `..`, and anything else.
- `googleGate`: public → allow; session → allow; API → unauthorized; otherwise redirect to
  `/login?returnTo=<encoded safe path>` where `/` with a safe `?returnTo=` preserves that path.

- [ ] **Step 4: Wire the middleware**

Refactor the current body into `applyLegacyPolicy(request)` (Basic gate + CSP/API pass-through).
Keep the named `middleware` export and matcher. Add:

```ts
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { googleGate } from "@/lib/auth-paths";
let googleAuth: ReturnType<typeof NextAuth>["auth"] | undefined;
function getGoogleAuth() { return (googleAuth ??= NextAuth(authConfig).auth); }

export async function middleware(request: NextRequest) {
  if (process.env.KM_IDENTITY_PROVIDER !== "google") return applyLegacyPolicy(request);
  return getGoogleAuth()((req) => {
    const decision = googleGate({ pathname: req.nextUrl.pathname, search: req.nextUrl.search, hasSession: Boolean(req.auth) });
    if (decision.kind === "allow") return applyLegacyPolicy(req);
    if (decision.kind === "unauthorized") return NextResponse.json({ error: { code: "AUTH_REQUIRED", message: "Sign in required." } }, { status: 401, headers: { "Cache-Control": "no-store" } });
    return NextResponse.redirect(new URL(decision.location, req.url));
  })(request);
}
```

`auth.config.ts` must remain Edge-safe. Do not import `auth.ts` or any MariaDB module here.

- [ ] **Step 5: Run the auth-path and existing site-password tests**

Run: `npx vitest run --config vitest.config.ts tests/unit/auth-paths.test.ts tests/unit/site-password.test.ts`
Expected: PASS. The site-password tests prove the non-Google path is unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth-paths.ts src/middleware.ts tests/unit/auth-paths.test.ts
git commit -m "feat(auth): gate the demo with Google sessions without changing other providers"
```

---

### Task 5: Login page and sign-out

**Files:**
- Create: `src/app/login/page.tsx`
- Create: `src/components/auth/sign-out-form.tsx`
- Modify: `src/app/w/[workspaceId]/profile/page.tsx`
- Test: `tests/unit/login-page.test.tsx` (create)

**Interfaces:**
- `/login` renders one `Continue with Google` button for the Google provider; it redirects `/` when
  a session already exists and for non-Google providers.
- The profile page shows a `Sign out` form only when `identityProviderKind() === "google"`.

- [ ] **Step 1: Write the failing login-page test**

Mock `@/auth` (`auth` returns null, `signIn` is a spy), `next/navigation`, and `next/headers` as
needed. Set `KM_IDENTITY_PROVIDER=google`. Render the async page with `returnTo=/s/token` and assert
the button text and that the form's action is a function. Also assert a non-Google provider redirects
or 404s (choose `redirect("/")` in the test's expectation).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/login-page.test.tsx`
Expected: FAIL — the page does not exist.

- [ ] **Step 3: Implement the login page**

Server component:

```tsx
import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { safeReturnTo } from "@/lib/auth-paths";
import { identityProviderKind } from "@/server/config";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  if (identityProviderKind() !== "google") redirect("/");
  if (await auth()) redirect("/");
  const { returnTo } = await searchParams;
  const target = safeReturnTo(typeof returnTo === "string" ? returnTo : undefined);
  async function continueWithGoogle() {
    "use server";
    await signIn("google", { redirectTo: target });
  }
  return (
    <main className="kh-page ...">
      <h1>Sign in</h1>
      <p>Use your Google account to open your My Space.</p>
      <form action={continueWithGoogle}><button className={buttonClasses()}>Continue with Google</button></form>
    </main>
  );
}
```

Use the existing `kh-page`/`buttonClasses` conventions; no external script, so the CSP stays as is.

- [ ] **Step 4: Implement sign-out and place it**

`src/components/auth/sign-out-form.tsx`:

```tsx
import { signOut } from "@/auth";
import { buttonClasses } from "@/components/ui/button";

export function SignOutForm() {
  async function action() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }
  return <form action={action}><button className={buttonClasses({ variant: "secondary" })}>Sign out</button></form>;
}
```

In `src/app/w/[workspaceId]/profile/page.tsx`, import `identityProviderKind` and `SignOutForm`;
return a fragment with the existing `PersonalProfileView` plus the form when the provider is
`google`. Other providers render exactly as before.

- [ ] **Step 5: Run the login test and typecheck**

Run: `npx vitest run --config vitest.config.ts tests/unit/login-page.test.tsx`
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/login/page.tsx src/components/auth/sign-out-form.tsx src/app/w/\[workspaceId\]/profile/page.tsx tests/unit/login-page.test.tsx
git commit -m "feat(auth): add Google sign-in and sign-out UI"
```

---

### Task 6: Environment template and deployment runbook

**Files:**
- Modify: `.env.example`
- Modify: `docs/operations/vercel-layerbase.md`
- Modify: `docs/operations/vercel-layerbase.zh-TW.md`
- Modify: `README.md` (short demo-login note)

**Interfaces:** exact operator steps; no code interface.

- [ ] **Step 1: Update `.env.example`**

Add a commented Google block:

```dotenv
# Google demo login (KM_IDENTITY_PROVIDER=google)
# AUTH_SECRET=generate-with-openssl-rand-base64-32
# AUTH_GOOGLE_ID=google-oauth-client-id
# AUTH_GOOGLE_SECRET=google-oauth-client-secret
# AUTH_URL=https://your-project.vercel.app
# Keep AUTH_URL equal to KM_PUBLIC_ORIGIN.
```

Document that `KM_SITE_PASSWORD` and `KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION` are not used for the
Google demo, and that `KM_REVIEW_WRITES_ENABLED=true` is the demo choice.

- [ ] **Step 2: Write the Google deployment section**

In both runbooks, add:

1. Create a Google Cloud OAuth client (Web application), add
   `https://<origin>/api/auth/callback/google` as an authorized redirect URI, and use the
   `openid email profile` scopes. Publish the consent screen for public access, or add test users.
2. Set `KM_IDENTITY_PROVIDER=google`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`,
   `AUTH_URL`, and keep `AUTH_URL === KM_PUBLIC_ORIGIN`.
3. Remove `KM_SITE_PASSWORD` and `KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION` from Production.
4. Set `KM_REVIEW_WRITES_ENABLED=true`; keep `KM_TEAM_WORKSPACES_ENABLED=false`.
5. Redeploy. The build fails fast if any Google auth variable is missing or the two origins differ.
6. Verify: `/` redirects to `/login`; Continue with Google creates a personal workspace; the
   bottom-left shows the Google profile name; sign-out returns to `/login`; a share link opens in a
   private window; a signed-in Google user can reply on a share page; `/api/health` stays public.
7. Note the Layerbase free-plan 20-connection limit; upgrade before a public demo.

Keep the existing local/company-SSO instructions intact; label the Google section as the demo path.

- [ ] **Step 3: Verify the docs are wired**

Run: `rg -n "AUTH_GOOGLE_ID|KM_IDENTITY_PROVIDER=google|callback/google" .env.example docs/operations/vercel-layerbase.md docs/operations/vercel-layerbase.zh-TW.md README.md`
Expected: matches in all four files.

- [ ] **Step 4: Commit**

```bash
git add .env.example docs/operations/vercel-layerbase.md docs/operations/vercel-layerbase.zh-TW.md README.md
git commit -m "docs(auth): document Google login for the demo deployment"
```

---

### Task 7: Full verification and handoff

- [ ] **Step 1: Run the DB-free gate**

```sh
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

Expected: all pass. `next build` must succeed with no Google env when
`KM_IDENTITY_PROVIDER` is unset (proving existing deployments are unaffected).

- [ ] **Step 2: Run the integration suite**

```sh
npm run test:integration
```

Expected: PASS, including the new Google identity integration test.

- [ ] **Step 3: Run the existing E2E smoke suites**

```sh
npm run test:e2e:smoke:personal
```

Expected: PASS. The Google path itself needs a real deployment and a Google account.

- [ ] **Step 4: Deployer-only steps**

- Create the Google OAuth client and consent screen.
- Set the Production env vars and remove the site password/local production flag.
- Deploy and perform the manual Google smoke test from the runbook.
- Confirm a second sign-in reuses the same user and personal workspace.
- Check Layerbase connection usage; upgrade if the demo is public.

- [ ] **Step 5: Commit only if Step 4 produced repo changes**

Otherwise this step is a no-op.

---

## Plan self-review

- **Spec coverage:** additive provider (§6, §9) → Tasks 2–3; Google identity resolution (§3) → Task
  1; JWT/session (§4) → Task 2; login/logout (§8) → Task 5; middleware/public paths (§7) → Task 4;
  env/build validation (§1, §10) → Tasks 2 and 6; review writes (§10) → Task 6; display name (§8) →
  Tasks 1 and 5; no migration → Task 1; verification → Task 7.
- **Existing providers:** Task 3 keeps their branches; Task 4 keeps the legacy middleware path; Task
  7 runs the existing suites. The only shared change is the direct-identity condition, which adds
  Google without altering local/company-sso.
- **Type consistency:** `GOOGLE_IDENTITY_PROVIDER_NAME`, `resolveGoogleIdentity`, `googleEmpId`,
  `googleDisplayName`, `authConfig`, `auth`, `signIn`, `signOut`, `googleGate`, `safeReturnTo`, and
  `isGooglePublicPath` are defined once and used with the same names later.
- **Review Focus tests:** non-Google isolation → site-password/identity suites; Edge import safety →
  typecheck/build plus the config split; first/returning login → Task 1 integration; 401/redirect and
  public paths → Task 4 tests; open-redirect → Task 4; build fail-fast → Task 2 tests.
