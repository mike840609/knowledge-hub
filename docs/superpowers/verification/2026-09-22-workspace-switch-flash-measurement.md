# Workspace-Switch Flash — Measurement

| Item | Details |
| --- | --- |
| Date | 2026-09-22 |
| Type | Measurement record (evidence, not a decision) |
| Version tested | `measure/workspace-switch-flash` (= `main` @ `29ffcf9`, PR #48 merged) |
| Motivation | Suspected `AppShell key={workspaceId}` (`src/app/w/[workspaceId]/layout.tsx`) causes the whole shell to unmount/remount and fetch the new shell model on the server for each workspace switch, creating visible flashing. Pending decision: hover-prefetch menu items versus current behavior; this measurement informs it |
| Conclusion | **The main cause of flashing is Suspense fallback throttling, the same as document navigation. The `key` contributes only a 0–110ms blank interval; the ~240ms skeleton hold is identical for both kinds of navigation.** |

## Method

Reuses the [2026-09-21 navigation latency measurement](./2026-09-21-navigation-latency-measurement.md) method:

- Production build (`make build` + `next start` at 127.0.0.1:3100, `KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION=true`), real MariaDB (`make db-up/db-migrate/db-seed`), single Chromium (Playwright MCP).
- **Time until content enters DOM**: in-page `MutationObserver` (first appearance of `[data-document-pane]` under the new URL), cross-checked against rAF frame sampling. Difference <15ms.
- **Network time**: `PerformanceResourceTiming`'s `responseEnd` (RSC response + two `/api/workspaces` calls). Playwright only opens the menu and clicks, without locator polling—the tool does not enter the results.
- **JS execution time**: `longtask` PerformanceObserver.
- **Frame phases**: rAF classifies each frame as `stale (old content) → blank (neither skeleton nor content) → skeleton → new-content`, recording transition timestamps. Blank, skeleton, and stale-shell are distinguished by computed DOM state (presence of `[data-document-pane]`, sr-only `Loading document*` status lines, and whether the URL changed), rather than visually inspecting screenshots.
- Transition tested: click `SWFP`/`Query Master` in the workspace menu → `router.push('/w/<id>/knowledge')` → redirect to the workspace's default document (exactly the user's clicked path, including actual in-page clicks to open/close the menu).
- Each number n=6 (workspace switches alternate QM→SWFP→QM…; controls switch Architecture↔Runbooks in the same workspace), reporting p50 + max instead of averaging away the distribution.

## Results

### Workspace switch (click workspace in menu → new workspace document settled), n=6

| run | Direction | Content enters DOM (MO) | Data ready (last RSC+API byte) | Frame sequence | Long tasks |
| --- | --- | --- | --- | --- | --- |
| 1 | SWFP→QM | 395ms | 154ms | stale→skeleton@78→content@410 | 0ms |
| 2 | QM→SWFP | **27ms** (router-cache hit, see below) | 98ms (only `/api/*`, no RSC request) | stale→blank@17→content@30, no skeleton | 0ms |
| 3 | SWFP→QM | 398ms | 145ms | stale→skeleton@80→content@413 | 0ms |
| 4 | QM→SWFP | 381ms | 142ms | stale→skeleton@64→content@396 | 0ms |
| 5 | SWFP→QM | 363ms | 149ms | stale→skeleton@66→content@365 | 0ms |
| 6 | QM→SWFP | 389ms | 141ms | stale→blank@67→skeleton@81→content@399 | 0ms |

| | p50 (including run 2) | max | Fresh-RSC p50 (excluding run 2) |
| --- | --- | --- | --- |
| Content enters DOM | **385ms** | 398ms | 389ms |
| Last network byte | ~143ms | 154ms | ~145ms |
| Total long-task duration | **0ms** | 0ms | 0ms |

One additional warmup (QM→SWFP, excluded from n): content 466ms, stale→blank@63→skeleton@173→content@473—the 110ms blank interval was the largest observed.

Server-only measurements (same route, bypassing browser, median of 5 curl HTML GETs each): **SWFP document 60ms, QM document 58ms, `/w/<id>/knowledge` redirect hop 33ms**. In-browser RSC chain approximately 140ms (layout RSC ~50ms + document RSC ~80ms + two `/api/workspaces` calls).

In other words, with fresh RSC: **data arrives by ~145ms, the main thread does no work, yet content appears only at ~385ms. The intervening ~240ms is pure waiting** (per-run data→content gaps: 241, 253, 239, 214, 248ms—a timer's signature).

### Control: document switching within the same workspace (Architecture↔Runbooks), n=6

| run | Content enters DOM (MO) | Data ready | Frame sequence | Long tasks |
| --- | --- | --- | --- | --- |
| 1–6 | 320 / 304 / 303 / 305 / 328 / 340ms | 77 / 84 / 79 / 78 / 85 / 126ms | All stale→skeleton@~15→content, no blank | 0ms |

p50 **313ms**, max 340ms. Data→content gap approximately ~230ms.

(The previous record's same kind of navigation had p50 383ms; these control documents are smaller, with data at 80ms versus the previous 130ms. Hold duration and conclusion are consistent.)

## Why

The ~385ms workspace switch separates into four identified stages:

1. **Redirect hop (~30–60ms, one extra RSC round trip).** The menu links to `/w/<id>/knowledge`, and the server redirects to the default document. The URL changes ~60–80ms after clicking, with the old shell unmounting at the same time. This cost is specific to workspace switching and absent from document navigation.
2. **Remount blank interval (0–110ms, intermittent).** `key={workspaceId}` unmounts the entire old AppShell; for the frames before the new shell RSC returns and the fallback commits, `<main>` is empty—rAF samples show neither `[data-document-pane]` nor skeleton. Timing determines its presence (only one 14ms interval in 6 regular runs, plus 110ms during warmup), so this is not a stable cost.
3. **Data wait (~145ms).** Layout RSC + document RSC + two `/api/workspaces` calls made immediately on mounting `useWorkspaceAuthorizationRefresh`. About 65ms more than same-workspace navigation (additional shell model and redirect chain).
4. **Skeleton hold (~215–250ms, stable).** After all data arrives, React still keeps the fallback for ~240ms before replacing it with content—the same number and mechanism as the control's ~230ms (Suspense fallback throttling confirmed in the previous record). **This stage is unrelated to `key`**; removing `key` would not shorten it by a millisecond.

Stage 4 is the main cause (~60%), stages 1+3 are secondary, and stage 2 (`key`'s direct cost) is smallest and unstable.

## What the router-cache hit (run 2) shows

Run 2 (QM→SWFP, 27ms) was the only App Router cache hit: zero RSC requests, zero skeletons, and only a 13ms blank (the remount itself) before content appeared. It proves two things:

- **When data is already in router cache, navigation never reaches the fallback**—the previous record's “only lever” hypothesis was empirically confirmed for workspace switching.
- Conversely, skeleton hold is the cost of showing the fallback: without a fallback, there is no 240ms hold.

## What this overturns / confirms

- **Confirms**: workspace flashing and document navigation are the same phenomenon (Suspense throttling), with the previous record's model directly applicable.
- **Overturns** the suspicion that `key={workspaceId}` is the main cause. The attributable `key` cost is only the remount blank (0–110ms, intermittent), while removing it risks leaking the old workspace's authorization state (the reason `useWorkspaceAuthorizationRefresh` exists)—a small uncertain gain does not justify a definite correctness risk.
- **Quantifies prefetch's ceiling**: if hover-prefetching menu targets (or `router.prefetch('/w/<id>/knowledge')`) makes every switch behave like run 2, content could enter DOM at ~30ms rather than ~385ms (including redirect resolution and remount), eliminating skeleton hold too—the only lever removing both network time and the 240ms hold. It costs an additional prefetch request per visible menu item (few workspaces, usually <10, a very different scale from document-tree prefetch).

## Decision: left open (measurement only, no implementation here)

- **Do not** remove `key={workspaceId}` (it is not the main cause).
- **Do not** implement hover-prefetch (pending decision).
- Options for the next decision: (a) menu-item hover-prefetch (ceiling ~30ms, with an RSC request per hover); (b) current behavior (~385ms p50, 0ms long tasks, no correctness risk). Actual prefetch cost/hit rate for (a) has not been measured; this record proves only the benefit on a hit.

## Method notes and limitations

- Skeleton detection uses sr-only `Loading document*` status lines (including tree's `Loading documents`), so it cannot distinguish document and tree skeletons; flashing concerns only “old content gone, new content not arrived,” leaving the conclusion unaffected.
- rAF sampling resolution is ~16ms; blanks <16ms may be recorded as a direct stale→skeleton transition, so blank values are lower bounds.
- Run 2 proves router cache accelerates revisits; the 6 runs alternate direction, with fresh and hit samples for both QM/SWFP, faithfully retaining the distribution without exclusions.
- Production server and DB remain running after measurement (3100 + MariaDB 3307); no product-code changes, no commit.

## Appendix (late night, 2026-09-22): hover-prefetch verification — measured, payoff unsupported, revert recommended

Version tested: `measure/workspace-switch-flash` + uncommitted prefetch edits (`WorkspaceSelector`: `onMouseEnter`/`onFocus` → `router.prefetch('/w/<id>/knowledge')`, skipping current workspace). This section answers only option (a) left open above: actual prefetch cost/hit rate.

### Method differences (relative to above; all else reused)

- Same production build (`make build`, then restart `next start` at 127.0.0.1:3100 to ensure the build includes prefetch), real MariaDB, single Chromium (Playwright MCP).
- Playwright only performs full-page `goto` (returning to the My Space document page before every run to clear router cache and ensure any hit comes from hover-prefetch); **menu opening/hover/click/focus use in-page synthetic event dispatch** (`mouseover` triggers React `onMouseEnter`, `click()`, `focus()`), because precise click timestamps require in-page `performance.now()`. Test A cross-checks once with real MCP `browser_hover`: same RSC-request shape and behavior.
- Timing still uses in-page `MutationObserver` (`[data-document-pane]`) + rAF phases + `PerformanceResourceTiming.responseEnd` + `longtask` observer, without Playwright locator polling.
- Direction fixed to My Space → SWFP (`0199f100-0000-7000-8000-000000000002`), full-page reload before each run; run 3's settle loop uses 100ms quanta (runs 1–2 use 8ms), with consistent content numbers and no effect on the conclusion.

### Test A (does prefetch fire?): yes, before any click

Fresh load (SWFP RSC count 0) → open menu → hover SWFP → `GET /w/0199f100-0000-7000-8000-000000000002/knowledge?_rsc=…` 200, with no click throughout. Four measured prefetch network durations: **46 / 41 / 45 / 48ms** (each a single RSC render of reads).

### Test B (click after hover, n=3): no cache-hit-level payoff

| run | Prefetch network | Click→URL change | Click→content enters DOM | Skeleton | New SWFP RSC requests at click | Long tasks |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 46ms | 21ms | **404ms** | Yes | 5 | 0ms |
| 2 | 41ms | 23ms | **380ms** | Yes | 5 | — |
| 3 | 45ms | ~101ms (100ms quanta) | **403ms** | Yes | 6 | — |

Compared with the unprefetched p50 **385ms** / max 398ms above, content entering DOM **does not improve**, and every run shows a skeleton. Run 2's 5 click-RSC requests are document page ×2, `sources`, `settings`, `new`—**only `/knowledge` itself is not refetched** (its prefetched redirect stub is reused), while the redirect-target document/layout RSC still fetches, followed by the same ~240ms Suspense hold. Click→URL change of 21–23ms (previous redirect hop ~60–80ms) is the only saving: approximately one RSC round trip.

Conclusion: **prefetch hits, but only the redirect stepping stone, not the actual content chain.** The earlier run 2's 27ms results from “the whole chain, including the default document, being in router cache”; hover-prefetch fetches only `/w/<id>/knowledge` (server redirect to default document), whose target document RSC is unknown at hover time, so each click still needs fresh RSC + skeleton hold.

### Test C (waste from hovering without clicking): exactly one RSC render

Open menu → hover SWFP → Escape closes menu: SWFP RSC count increases from 0 to **1** (48ms), URL stays unchanged, menu closes, and no additional requests follow (whole-page RSC count 11→12). **Unit cost of a miss = one RSC render (~45ms server), without navigation or state changes.** Also confirmed skip-current: hovering current “My Space” leaves RSC count unchanged (0 added).

### Keyboard path: focus also prefetches

Fresh load → open menu → `focus()` on “Query Master” (`0199f100-…0001`, prior RSC count 0) → its `/knowledge?_rsc` request appears (71ms), URL unchanged. `onFocus` behaves like `onMouseEnter`. Touch has no hover and falls back to current behavior by design (no additional work).

### Verdict: **revert (a few lines)**

Prior agreement: keep if hover→click payoff is confirmed, revert if there are never hits. The measured result is an intermediate but unfavorable case, recorded faithfully:

- Prefetch **hits every time** (rather than “never hitting”)—but only the redirect stepping stone.
- The anticipated payoff (every switch like run 2: ~30ms, zero RSC, zero skeleton) is **disproved**: three hover→click DOM times are 404 / 380 / 403ms, all with skeletons and 5–6 fresh RSC requests at click.
- Only one RSC round trip for the redirect hop is saved (URL changes ~40–60ms sooner), negligible relative to the 385ms baseline; each hover/miss costs one server render (few workspaces, but opening the menu may trigger several).

To reproduce run 2, the entire RSC chain including the default document must be prefetched—the target document must be known at hover time, beyond these few lines. Reverting the prefetch lines is therefore recommended, restoring current behavior (~385ms p50, 0ms long tasks, no correctness risk). Any future attempt must first solve the “unknown redirect target” prerequisite; otherwise measurements will have the same shape.

Measurement status: production server (3100, build includes prefetch) and MariaDB (3307) remain running; no commit (prefetch edits remain uncommitted).
