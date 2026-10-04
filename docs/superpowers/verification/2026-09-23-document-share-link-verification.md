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
| Unit + typecheck + lint + build | `make verify` | exit 0; unit 50 files, 408 tests passed; build lists `ƒ /s/[token]` |
| Integration | `npm run test:integration` | 43 files, 444 tests passed |
| E2E, full suite (after merging `main` @ `c03e8b3`) | `npm run test:e2e` | 80 passed, including `share-link.spec.ts` |

Numbers are from the run after the review fixes below.

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
| `readShared` is the only caller-less content method | `tests/unit/share-link-single-exception.test.ts` — knowledge application methods and exported functions (async or not, multi-line parameters) must take a `CallerContext`-typed parameter; the web layer may not read revision repositories; only `src/server/share-read.ts` calls the caller-less entry. Each rule was checked by planting a violation and seeing the test fail |
| Resync apply and link creation do not deadlock | `share-link-service.test.ts` — three rounds of a folder resync apply racing `create` on the same My Space source |
| A Hub user holding a link gains nothing else (§6.2) | `share-link-service.test.ts` — not in their workspace list, not in their search (the owner's search finds it), `getDocument` refused |
| Management API returns a path, not a URL; error codes | `tests/integration/share-link-api.test.ts`, `tests/unit/share-link-error-mapping.test.ts` |
| `/s/:token` works with no sign-in and no identity provider | E2E reads the link on `phase3UnconfiguredOrigin()`, a Company-SSO build with no session reader |
| Every other page on that origin still fails without sign-in | E2E: `/w/<my space>/knowledge` and `/api/workspaces` on the same origin are not 200 |
| Revoke is two-step and ends access; unknown and malformed tokens look identical | E2E steps 5–6, HTTP 404 with the same text |
| `/s/*` headers, no Open Graph tags | E2E asserts `referrer-policy`, `cache-control`, `x-robots-tag`, the exact CSP `img-src 'self'; frame-ancestors 'none'`, and no `og:` meta |

## Review fixes

Findings from a code review against the spec and the frontend design
contract, all fixed in this PR:

- **CSP replaced instead of added.** Next.js keeps only the last matching
  header per key, so the `/s/*` rule's `frame-ancestors 'none'` dropped the
  global `img-src 'self'` on the one unauthenticated page. `/s/*` now sends
  both directives in one header; spec §6.4 says so and E2E asserts the value.
- **Spec §4 asked for the full link to be shown.** The dialog now shows it in
  a read-only field. The automatic copy after the create request is gone:
  a clipboard write after a network round trip can be refused for lack of a
  user gesture, which showed an error right after a successful create.
- **Stale list response.** Closing the dialog on one document and opening it
  on another before the first list returned could show the first document's
  links. Responses for a document the dialog is no longer open for are dropped.
- **Source status.** A document ACTIVE inside an archived source was offered
  "Share link…", which creation then refused. The registry target's status
  now folds in the source's (row menu, palette, header); spec §10.1 records it.
- **Header not driven by the registry.** Spec §10.1 says the header takes the
  action from the registry; it now asks `availableActions` instead of
  re-deriving the rule on the page.
- **A full link limit paused the shell.** `SHARE_LINK_LIMIT_REACHED` (409)
  triggered the workspace access re-check meant for authorization changes;
  it is now exempt, like `REVISION_CONFLICT`.
- **Design contract.** The dialog was `rounded-lg`; §5 puts modals at `xl`.
  The share page used `pb-12`, which is off the replaced spacing scale and
  compiled to nothing. The dialog's `<summary>` now uses `kh-focus-ring`.
- **Silent failures.** `/s/:token` still shows one page for every failure,
  but errors other than "link not available" (database down, missing current
  revision) are now logged, without the token.
- **Gateway exemption was incomplete.** Spec §6.1 and the checklist now
  exempt `/_next/static/*` as well; without it the shared page loads with no
  CSS, fonts or client scripts.
- **Duplication.** `workspaceHttp` answers 204 itself, so the revoke route
  uses it; `requestShare()` and `writeLinkToClipboard()` replace hand-written
  copies of the event dispatch and the clipboard write.

## Pre-launch checklist (spec §15)

To be completed and recorded by whoever deploys; none of this is in code.

- [ ] The SSO gateway exempts `/s/*` and `/_next/static/*` and nothing else (attach the config excerpt; spec §6.1). Without the second, the shared page renders unstyled.
- [ ] The Hub host's network reach is recorded (intranet / external). If external, share links are readable from the internet.
- [ ] Reverse-proxy access logs mask the token after `/s/`.
- [ ] The gateway rate-limits `/s/*`.
- [ ] The security team knows this adds a read path that needs no sign-in.
