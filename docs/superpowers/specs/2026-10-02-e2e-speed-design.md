# E2E performance design draft

Goal: shorten daily feedback and full regression time while retaining real browser, identity, and authorization-boundary verification. Based on the runner from PR #99. The original full regression recorded 219 passed and 2 skipped, totaling 454.82 seconds, with readiness plus browser at 399.16 seconds. The original temporary log no longer exists; historical one-off case durations are not a current ranking.

## Approach and trade-offs

Use staged delivery: first explicit smoke groups and coverage inventory, then remove proven duplicate browser permutations and setup UI work, finally isolate data and evaluate parallelism. Raising worker count alone breaks shared-data assumptions; removing many cases directly lacks coverage evidence.

## Phase 1: fast feedback and inventory

- Add `test:e2e:smoke` and `test:e2e:smoke:personal`. Keep `test:e2e` as full regression; do not replace CI's full gate with smoke.
- Tag existing Playwright cases for stable selection rather than maintaining a title-string list. Team smoke covers workspace entry, rendered-editor hydration, create/save, SSO anti-spoofing and authorization, anonymous sharing and revocation. Personal smoke covers disabled Teams, cross-browser drafts, save, organization, export, favorites, and recovery of a new draft after closing its tab.
- Do not tag every editor test as smoke. Save races, keyboard, focus, and similar cases remain in full E2E.
- Create a coverage matrix. Each removal candidate must identify the original E2E assertions, replacement tests, defects they catch, and representative browser cases that must remain.
- Persist Playwright JSON and runner phase timings in ignored test artifacts, with separate records for full and smoke suites. Retain passed/failed/skipped outcomes; zero tests is not a pass.

Current inventory: `authored-title.test.ts` covers pure rules such as title precedence. The H1 case in `document-composer.spec.ts` also verifies disappearing fields, warnings, and editing interactions, so a similarly named unit test does not justify removing it. `organize-api.test.ts` covers routes, authorization, and writes; `zz-organize.spec.ts` additionally covers toasts, menus, and Undo, requiring corresponding UI evidence.

## Phase 2: shorten individual cases

- Review the phase-1 matrix item by item. Remove only E2E rule permutations fully covered by replacement tests with no additional browser behavior. When necessary, first add missing unit/integration assertions and observe failure followed by passing after the fix.
- Use existing API fixtures for organization setup. For example, create a folder and document via API for the nonempty-folder archive test, but archive through the UI and verify refusal, toast, and retained data. Keep representative UI coverage of folder/document creation itself.
- Do not hide failures with fixed sleeps, retries, weakened assertions, or increased timeouts. Do not skip required production builds.

## Phase 3: isolation and parallelism

- Identify shared My Space, graph layout, fixed titles/sources/memberships, and similar assumptions. Give specs their own users/workspaces or databases and verify consistency in isolation and different execution orders.
- Isolate identity servers, databases, ports, and build outputs by execution unit. Changing Playwright workers from 1 to 4 does not establish isolation.
- Measure two execution units before evaluating four. Enable default parallelism only after isolation and full regression verification. CI shards may use separate job checkouts/databases/ports; local parallel runs must not overwrite one another's `.next`.

## Acceptance and delivery

1. After phase 1, actually run both smoke modes with no unexpected skips; full regression still covers the complete existing set.
2. Each candidate moved between layers has explicit equivalent coverage; reducing test count is not the goal.
3. API-fixture acceleration preserves tested UI behavior and assertions.
4. Verify different orders and repeated runs after isolation, with no new full-regression failures.
5. Report preparation, build, browser, cleanup, and total for each mode, distinguishing cold/warm builds without promising a speedup ratio beforehand.
6. Commit and review phases independently: deliver useful smoke first, then proceed incrementally. Do not replace full CI checks with smoke on your own.

Only the design draft and initial inventory are complete at this point; tests, CI, and the runner have not changed. After approval, write a concrete implementation plan listing initial tagged cases, coverage inventory, and verification commands for review.
