# Document share link verification

Date: 2026-09-23

- Spec: `docs/superpowers/specs/2026-09-23-document-share-link-design.md`
- Plan: `docs/superpowers/plans/2026-09-23-document-share-link.md`
- Branch: `claude/personal-wiki-team-share-70zt2m` (PR #52)

## Environment

- Node.js `v22.22.2`.
- MariaDB 10.11 via `make db-up` (container `hcm-km-phase0-mariadb-1`, `127.0.0.1:3307`).
- Playwright's pinned Chromium build (1243) was not installed in this
  environment; the pre-installed headless shell (1194) was exposed under the
  expected path through `PLAYWRIGHT_BROWSERS_PATH` pointing at a scratch
  directory. No repository configuration was changed for this. CI installs the
  pinned build as usual.

## Results

| Gate | Command | Result |
| --- | --- | --- |
| Baseline before any change | `npm run test:integration` | 40 files, 413 tests passed |
| Unit + typecheck + lint + build | `make verify` | exit 0; unit 50 files, 402 tests passed; build lists `ƒ /s/[token]` |
| Integration | `npm run test:integration` | 43 files, 442 tests passed |
| E2E, new spec | `npm run test:e2e -- tests/e2e/share-link.spec.ts` | 1 passed |
| E2E, full suite | `npm run test:e2e` | 78 passed |

## Spec §13 completion criteria → evidence

| Criterion | Evidence |
| --- | --- |
| Each §5.2 validity rule fails alone | `tests/unit/share-link-domain.test.ts` — one case per reason |
| Each §5.1 creation rule; SOURCE_MANAGED may be shared | `share-link-domain.test.ts`; `share-link-service.test.ts` "shares SOURCE_MANAGED content" |
| Registry offers `document.share` only on PERSONAL + ACTIVE + CURRENT, ownership ignored | `tests/unit/action-registry.test.ts` — `document.share` block |
| Rejected creation writes neither link nor audit row | `share-link-service.test.ts` — stranger, Team document |
| Link and `DOCUMENT_SHARE_LINK_CREATED` are atomic | `share-link-service.test.ts` — audit append replaced with a failing one, no link row remains |
| Token is UUIDv4, not adjacent to a neighbour, not equal to `id`/`document_id`; audit payload has no token | `share-link-service.test.ts` — "never issues a token computable from a neighbouring ID", "appends one audit event…" |
| Malformed token never reaches the database | `share-link-service.test.ts` — unit-of-work call count is 0 |
| Revoked, expired, archived document, archived source, creator without access → unusable | `share-link-service.test.ts` — `refuses a link once …` (five cases) |
| Owner's edits reach the reader (A2) | `share-link-service.test.ts` "follows the owner's edits"; E2E step 4 |
| Views counted per link per day, nothing identifying | `share-link-schema.test.ts` (columns); `share-link-service.test.ts` (count = 3) |
| A failed view count does not block reading (A5) | `share-link-service.test.ts` — recordView replaced with a failing one |
| `readShared` is the only caller-less content method | `tests/unit/share-link-single-exception.test.ts` |
| Management API returns a path, not a URL; error codes | `tests/integration/share-link-api.test.ts`, `tests/unit/share-link-error-mapping.test.ts` |
| `/s/:token` works with no sign-in and no identity provider | E2E reads the link on `phase3UnconfiguredOrigin()`, a Company-SSO build with no session reader |
| Every other page on that origin still fails without sign-in | E2E: `/w/<my space>/knowledge` on the same origin is not 200 and does not contain the body |
| Revoke is two-step and ends access; unknown and malformed tokens look identical | E2E steps 5–6, HTTP 404 with the same text |
| `/s/*` headers, no Open Graph tags | E2E asserts `referrer-policy`, `cache-control`, `x-robots-tag`, `content-security-policy`, and no `og:` meta |

## Not covered by an automated test

- Spec §6.2's first two bullets (the reader's search results and workspace
  selector) have no dedicated test. A share link writes no membership or
  capability, so these follow from the existing Phase 3/4 authorization
  tests; the single-exception scan guarantees there is no second caller-less
  read path.

## Pre-launch checklist (spec §15)

To be completed and recorded by whoever deploys; none of this is in code.

- [ ] The SSO gateway exempts `/s/*` and nothing else (attach the config excerpt).
- [ ] The Hub host's network reach is recorded (intranet / external). If external, share links are readable from the internet.
- [ ] Reverse-proxy access logs mask the token after `/s/`.
- [ ] The gateway rate-limits `/s/*`.
- [ ] The security team knows this adds a read path that needs no sign-in.
