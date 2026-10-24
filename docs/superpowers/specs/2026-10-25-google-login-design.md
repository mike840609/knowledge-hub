# Google login for the demo site — design

**Date:** 2026-10-25
**Status:** Proposed
**Scope:** add a Google identity provider to the demo deployment without changing the existing
`local` or `company-sso` providers.

## Intent

The public demo should let visitors sign in with a Google account, get their own personal
workspace, and use the product without a shared site password. The existing local-identity and
company-SSO paths must keep working exactly as they do today; Google is an additional provider,
selected by configuration, not a replacement.

## Goals

- `KM_IDENTITY_PROVIDER=google` enables Google OAuth through Auth.js v5.
- First Google sign-in creates a Hub user, an external identity link, and (on the next request)
  the user's personal workspace. No schema migration.
- The generated identity is `emp_id = DEMO-<deterministic suffix>`, `org_code = DEMO`; the name
  comes from the Google profile.
- Owner pages redirect unauthenticated visitors to `/login`; owner APIs answer 401; share links,
  the share-review API, `/api/health`, and the auth endpoints stay public.
- `local` and `company-sso` code paths, environment semantics, readiness checks, and the optional
  site-password gate remain unchanged when `KM_IDENTITY_PROVIDER` is not `google`.
- Sign-out clears the session.

## Non-goals

- Username/password credentials, password reset, email verification, invite codes, or Turnstile.
- Concurrent provider fallback (for example Google *and* company SSO on one deployment). The
  deployment selects one provider with `KM_IDENTITY_PROVIDER`.
- Team workspaces, roles, admin screens, or cross-user sharing beyond the existing share links.
- Automatic demo-data deletion (a later operational task).
- Linking an existing company-SSO user to a Google account by email.

## Current state

- `IdentityProvider` has two implementations: `LocalIdentityProvider` (server-configured user)
  and `CompanySsoIdentityProvider` (trusted session reader).
- `establishTrustedCaller` treats the local provider specially: it uses `getCurrentIdentity()`
  directly instead of resolving an external identity link. Company SSO goes through
  `HubIdentityResolver`.
- `users` has `id`, `emp_id`, `name`, `org_code`; `external_identity_links` already stores
  `(provider, subject_bytes) -> hub_user_id` with uniqueness on both pairs. No password or
  session table exists.
- The middleware already runs on the Edge, sets a per-response CSP, and implements the optional
  `KM_SITE_PASSWORD` Basic gate. It must not learn to query MariaDB.
- `workspaceHttp` already maps `AUTH_REQUIRED` to 401, so an API that misses the middleware gate
  still fails closed.

## Approaches considered

1. **Auth.js v5 Google provider with JWT sessions (chosen).** Google verifies the account; there
   is no password storage, reset flow, or custom login endpoint. Auth.js handles the OAuth state,
   CSRF, signed JWT, and cookies.
2. **Credentials provider with username/password.** Rejected for this demo: it adds password
   hashing, reset, rate limiting, and bot mitigation for little product value.
3. **Hand-rolled DB sessions and cookies.** Rejected: more security surface for no benefit.
4. **Concurrent provider chain.** Rejected: the deployment already selects one provider by
   environment; adding fallback logic would change the trusted-caller contract.

## Design

### 1. Dependency and configuration split

Add `next-auth@5.0.0-beta.32` (pin the exact beta). Split the configuration so the Edge middleware
never imports MariaDB:

- `src/auth.config.ts` — Edge-safe: Google provider, `session: { strategy: "jwt", maxAge: 7 days }`,
  `pages: { signIn: "/login" }`, and the `authorized`/path-independent options. No database
  imports.
- `src/auth.ts` — full Node configuration: spreads `authConfig`, adds the `jwt` and `session`
  callbacks that use the database. Exports `handlers`, `auth`, `signIn`, `signOut`.
- `src/app/api/auth/[...nextauth]/route.ts` — exports `GET`/`POST` from `handlers`.

Environment: `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and the canonical
`AUTH_URL=https://<production-origin>`. `AUTH_URL` defaults to `KM_PUBLIC_ORIGIN` when unset; if
both are set and differ, the production build fails instead of letting Auth.js and the review
origin checks disagree. The Google OAuth client's redirect URI is
`https://<production-origin>/api/auth/callback/google`.

When `KM_IDENTITY_PROVIDER === "google"`, the Vercel build validates `AUTH_SECRET`,
`AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and an origin (`AUTH_URL` or `KM_PUBLIC_ORIGIN`) before
`next build`. A missing value fails the deployment, so a typo cannot publish a half-broken demo.

### 2. Pool extraction (no behavioural change)

Move the `globalThis`-pinned pool singleton from `src/server/composition.ts` into
`src/server/database-pool.ts` (`getDatabasePool`, `closeDatabasePool`). Composition imports it and
re-exports `getDatabasePool` for the existing health route and tests. This lets `src/auth.ts`
resolve users without importing the composition root and creating a cycle through the Google
provider.

### 3. Google identity resolution

`src/server/google-identity.ts` exports:

```ts
resolveGoogleIdentity(input: { subject: string; name: string }): Promise<UserIdentity>
```

It calls the existing `HubIdentityResolver` with:

- `provider: "google"`
- `subject`: the Google `sub` claim
- `emp_id`: `DEMO-` + the first 10 uppercase hex characters of SHA-256(subject)
- `name`: the Google profile name; if Google returns no name, the email local-part; if neither is
  available, `Demo user`. Trim and cap at the schema limit (512).
- `org_code: "DEMO"`

The resolver already handles the transaction, the `(provider, subject)` link, races, and profile
updates. On the first sign-in it inserts the user and link; on later sign-ins it returns the same
user and refreshes `name`/`org_code` if they changed. No migration is added.

### 4. JWT and session shape

In `src/auth.ts`:

- `jwt({ token, account, profile })`: when `account?.provider === "google"` and `profile.sub` is a
  string, call `resolveGoogleIdentity` and store `hubUserId`, `empId`, `orgCode`, and
  `displayName` on the token. Other providers are not handled by this deployment.
- `session({ session, token })`: copy those fields onto `session.user`.
- Add `next-auth` module augmentation for `Session.user` and `JWT`.

The JWT is signed/encrypted by Auth.js, stored in an HttpOnly, Secure (production), SameSite=Lax
cookie. No session table.

### 5. Google identity provider

`src/infrastructure/identity/google-identity-provider.ts`:

- `GOOGLE_IDENTITY_PROVIDER_NAME = "google"`.
- `getCurrentIdentity()` reads `auth()`. Without a session it throws `AuthRequiredError`; with a
  session it returns `validateUserIdentity({ id: session.user.hubUserId, emp_id, name, org_code })`.
- `getCurrentClaims()` returns the same identity as provider `"google"`, subject = Hub user id,
  with empty group/capability lists. It exists for interface completeness; the direct path below
  does not need it for resolution.

### 6. Provider selection and trusted caller

- `identityProviderKind()` gains `"google"` alongside `"local"` and `"company-sso"`.
- `createIdentityProvider` returns `new GoogleIdentityProvider()` for `"google"`, after failing
  fast if `AUTH_SECRET`, `AUTH_GOOGLE_ID`, or `AUTH_GOOGLE_SECRET` is missing. The `local` and
  `company-sso` branches are untouched.
- `establishTrustedCaller` extends its direct-identity branch from
  `provider === LOCAL_IDENTITY_PROVIDER_NAME` to also include `GOOGLE_IDENTITY_PROVIDER_NAME`.
  Company SSO still goes through `HubIdentityResolver`; existing behaviour is unchanged.
- The existing `users.upsertIdentity` and `ensurePersonalWorkspace` calls continue to run, so a
  Google user's personal workspace is created on the first authenticated request.

### 7. Middleware

`src/middleware.ts` keeps the existing CSP and optional `KM_SITE_PASSWORD` code. The Google check
is additive and only runs when `KM_IDENTITY_PROVIDER === "google"`:

- Instantiate the Edge-safe Auth.js wrapper lazily, inside the Google branch:
  `NextAuth(authConfig).auth` is created only when that provider is selected. The module-level
  import must not throw or read the database for local/company-sso deployments.
- Public paths for Google:
  - `/login`, `/api/auth/*`, `/api/health`, `/api/share-review/*`, `/sample-wiki/*`;
  - `/s` and `/s/<token>` — the public read page;
  - static assets already excluded by the matcher.
- `/s/<token>/open` is **protected**: it calls `establishTrustedCaller`, so a signed-out visitor
  is redirected to `/login?returnTo=/s/<token>/open`. The share-page link and its tests stay
  unchanged.
- Without `request.auth`:
  - `/api/*` → `401` JSON `{ error: { code: "AUTH_REQUIRED", message: "Sign in required." } }`,
    `Cache-Control: no-store`;
  - pages → redirect to `/login?returnTo=<safe path>`.
- With a session, continue to the existing page CSP / API pass-through.
- `returnTo` is validated by a pure helper. Accepted values are `/`, `/w/...`, and `/s/...`; any
  other value becomes `/`. When a request for `/` carries the existing
  `?returnTo=/s/<token>`, the middleware preserves that path instead of replacing it with `/`.
- If `KM_SITE_PASSWORD` is also set, the existing Basic gate still runs first. The deployment
  docs say to unset it for the Google demo.
- `skipMiddlewareRequestBody: true` remains; the middleware never reads bodies.

### 8. Login and logout UI

- `src/app/login/page.tsx`: server component. If `auth()` already has a session, redirect `/`.
  Otherwise render a single **Continue with Google** button inside a form whose server action calls
  `signIn("google", { redirectTo: safeReturnTo(returnTo) })`. No external script; the CSP does not
  need `accounts.google.com`.
- `src/components/auth/sign-out-button.tsx`: a small form with a server action calling
  `signOut({ redirectTo: "/login" })`; placed in the profile page (or the account area of the app
  shell). No client-side auth JavaScript is required.
- The login page is the only new public page; there is no registration form.
- The bottom-left account menu shows `users.name` (Google profile name, then email local-part, then
  `Demo user`). `emp_id` is not shown in the shell; it is passed only to the feedback report. The
  avatar stays the generic user icon; no Google profile picture is stored.

### 9. Existing providers stay intact

- `LocalIdentityProvider`, `CompanySsoIdentityProvider`, their factory branches, readiness checks,
  and environment semantics are not modified.
- `KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION`, `KM_LOCAL_*`, and `KM_COMPANY_SSO_*` keep their current
  meaning. A deployment that does not set `KM_IDENTITY_PROVIDER=google` behaves exactly as before,
  including the optional site-password gate.
- The Google code paths are additive and selected only by configuration.

### 10. Deployment changes for the demo

- Add `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_URL` (production origin).
- Set `KM_IDENTITY_PROVIDER=google`.
- Remove `KM_SITE_PASSWORD` and `KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION` from Production; keep
  `KM_LOCAL_*` for local development only.
- Keep `KM_TEAM_WORKSPACES_ENABLED=false`; each Google user gets My Space only.
- Set `KM_REVIEW_WRITES_ENABLED=true`: anonymous writes remain 401, and signed-in Google users can
  reply. This makes the share page's sign-in call-to-action meaningful and needs no share-panel UI
  change.
- Google Cloud: create an OAuth client, add the exact redirect URI, publish the consent screen
  (basic `openid email profile` scopes), and add test users if the app remains in testing mode.
- The Google OAuth client and `AUTH_SECRET` are server-side secrets; never prefix them with
  `NEXT_PUBLIC_`.

### 11. Security

- Auth.js owns OAuth state, CSRF, JWT signing, and cookies; there is no password endpoint to
  brute-force.
- Google verifies the account and email; no open registration form.
- The JWT lasts 7 days; rotating `AUTH_SECRET` invalidates every session. Logout clears the cookie.
- No session table means a stolen token is valid until expiry; acceptable for a demo with
  disposable data. Revocation is a future concern.
- Owner-data isolation remains the existing workspace membership check; share links stay public by
  design.
- `returnTo` is whitelisted, preventing an open redirect.

## Verification

- Existing `local` and `company-sso` unit/integration/E2E suites pass unchanged.
- New unit tests:
  - `isGooglePublicPath` and `safeReturnTo`.
  - `GoogleIdentityProvider` maps a mocked session, and throws `AuthRequiredError` without one.
  - `createIdentityProvider("google")` fails fast without its env; local/company-sso branches are
    unchanged.
  - `establishTrustedCaller` uses direct identity for `google` and still uses the resolver for
    company SSO.
  - `resolveGoogleIdentity` generates a stable `DEMO-…` emp id and caps the name.
- New integration test (real MariaDB):
  - first Google sign-in creates one user and one `(google, subject)` link;
  - a second sign-in reuses the same user;
  - a changed Google name updates `users.name`;
  - two Google users receive separate personal workspaces.
- Route/middleware tests:
  - unauthenticated `/` → `/login`; `/api/documents/...` → 401;
  - `/api/health`, `/s/<token>`, `/api/share-review/*`, `/api/auth/*`, `/login` remain public;
  - `/s/<token>/open` without a session redirects to
    `/login?returnTo=/s/<token>/open`;
  - `/` with `?returnTo=/s/<token>` keeps that path through the login redirect;
  - an unsafe `returnTo` (`https://evil.example`, `//evil.example`) becomes `/`;
  - a valid mocked session reaches the page/API.
- Config tests:
  - `authUrl()` defaults to `KM_PUBLIC_ORIGIN` and rejects a mismatched explicit `AUTH_URL`;
  - `vercel-build.mjs --dry-run` exits 1 when provider is `google` and an auth env is missing,
    and exits 0 when the complete set is present.
- Manual production smoke: Google login, personal workspace, create/edit a document, sign out,
  share link in a private window, post a reply as a signed-in Google user, `/api/health`.

## Risks

- **next-auth v5 beta.** Pin beta.32 and verify it works with Next 15.5/React 19 in the actual
  Vercel build; this is the largest integration risk.
- **Edge bundle.** If the middleware accidentally imports `auth.ts` instead of `auth.config.ts`,
  the MariaDB driver enters the Edge bundle and the build fails. Keep the split strict.
- **Google OAuth setup.** A wrong redirect URI or an unpublished consent screen keeps everyone
  except test users out. This is a deployer checklist item.
- **No server-side session revocation.** JWT expiry is 7 days; rotate `AUTH_SECRET` if needed.
- **Layerbase free tier has 20 connections.** A public demo with several concurrent users may
  exhaust it; upgrade the plan or lower `KM_DB_POOL_SIZE` before launch.
- **Existing local user is not linked.** The seeded local user keeps its data but cannot sign in
  with Google; Google users start with new personal workspaces. No data is deleted.
- **Interim exposure.** Until Google login is deployed, the site has no gate; either keep
  `KM_SITE_PASSWORD` temporarily or do not share the URL.
- **Vercel Hobby** is for personal, non-commercial use; a public demo must fit that or use Pro.

## Left to the builder

- Exact file paths, type augmentations, and test locations for the Auth.js split.
- The precise sign-out placement in the existing shell/profile UI.
- The exact `emp_id` suffix length and name truncation helper.
- Whether to keep the optional site-password code path in the middleware (it stays, but the demo
  unsets it).
