# Personal Workspace Knowledge Links and Graph — Verification Record

| Item | Details |
| --- | --- |
| Date | 2026-09-29 |
| Subject | [Design](../specs/2026-09-29-personal-workspace-knowledge-graph-design.md), [plan](../plans/2026-09-29-personal-workspace-knowledge-graph.md): TOC, link index (migration 012), wikilink/relative `.md` rendering, Backlinks, Workspace/Local graph |
| Environment | Development container; MariaDB 10.11.14 (locally installed, `127.0.0.1:3307`); Node 22; environment-bundled Chromium 1194 provided to Playwright 1.63 through a shim (outside the repo/change) |
| Conclusion | All passed. After rebasing onto main (§10): unit 735, integration 486, e2e 145; `tsc --noEmit`, `eslint .`, `next build` all green (before rebase this branch's own counts were 620/486/107, §1). Performance in §3; issues caught during implementation in §4; omissions in §6; graph visual redesign with Linear vocabulary in §7; title-row chip and inspector-tab memory in §8 |

## 1. Baseline and results

| Layer | Before work | After completion | Added |
| --- | --- | --- | --- |
| unit (`make test-unit`) | 427 (51 files) | **620 (66 files)** | +193 |
| integration (`make test-integration`) | 444 (43 files) | **486 (46 files)** | +42 |
| e2e（`make test-e2e`） | 91 | **107** | +16 |
| typecheck / lint / build | Clean | Clean | — |

Pre-work unit 427 and integration 444 were actually run on clean `main`; e2e 91 is calculated from full 107 minus this change's 16 additions (not separately run on clean `main`). **No existing tests were changed merely to accommodate new behavior**: three existing test files changed; two changes update existing assertions for deliberate contract changes, while the third only adds a case:

- `action-registry.test.ts`: actions available to a member with no capabilities change from `["navigate.knowledge"]` to `["navigate.knowledge", "navigate.graph"]` (reading Knowledge permits viewing its graph, spec §11).
- `phase2-import-apply-perf.test.ts`: stub gains `links` (otherwise `projectDocument` throws because the repository is missing), adding an assertion that “50 documents produce exactly 50 index writes” (§4 item 2: this assertion was initially not actually applied).
- `share-link-single-exception.test.ts`: adds only one case (share page must not touch the link service); three existing cases unchanged.

## 2. Slice coverage

| Slice | Main tests |
| --- | --- |
| 1 TOC | `heading-slug` (8), `markdown-outline` (10), `markdown-renderer-headings` (10, individually comparing rendered `id` to outline slug, including CJK, duplicates, GFM strikethrough, setext, nesting), `active-heading` (7); 4 e2e `reading-outline` cases |
| 2 Index | `document-links-extract` (30, every rule-table row in spec §5), `link-resolution` (25, including total-order tie-break independent of input order), `link-index-write-points` (2, source scan); integration `link-index` (schema, four write points, repository, stale detection), `link-index-reindex` (5, including save races), `knowledge-link-service` (19, including authorization, indistinguishable cross-Workspace results, archiving, rename) |
| 3 Rendering / Backlinks | `markdown-renderer-links` (19), `link-context` (8), `link-graph` (19), `action-registry` (+5), `share-link-single-exception` (+1); 7 e2e `reading-links` cases (including title-row chip and inspector-tab memory, one each, §8), with **actual `/s/:token` page** (sessionless origin) containing no `/w/` or broken-link markers |
| 4 Graph | `graph-layout` (18), `graph-model` (19); 5 e2e `workspace-graph` cases (nodes/counts, Unresolved/Orphans filters, find highlighting, zoom/reset, exact List-view counts, Local graph/depth, empty state, command palette, nonmember 404) |

Screens were additionally visually checked individually in a real browser (1440/1100/1500 widths; rail, expandable TOC, resolved/alias/unresolved links, Linked from, Links tab, graph hover emphasis, List view, local graph).

## 3. Measurements

**Method.** In an isolated database, directly wrote 2 000 Hub documents through repositories, each with 10 `[[wikilink]]` entries (20 000 edges, all pointing to random other documents); called services 15 times for median/p95 (8 for graph). Script is outside repo (one-off measurement).

| Item | Result | Spec target (§14) |
| --- | --- | --- |
| `getDocumentLinks` (document with approximately 10 backlinks) | Median **96 ms**, p95 119 ms | “< 100 ms”—**median meets it, p95 slightly exceeds**; spec updated to truthful numbers |
| `getDocumentLinks` + depth-2 local graph | Median 131 ms, p95 177 ms | — |
| `getWorkspaceGraph` (cap 1000) | Median 133 ms (excluding layout) | — |
| `layoutGraph`, synthetic graph of 1000 nodes/3000 edges | **Approximately 1.0 s** (909/994/1039 ms over three runs; 2.27 s before tick adjustment) | “< 1.5 s” |
| Extract one 3.7 KB document with 40 links | 4–8 ms (including 6.6 ms Markdown parsing) | — |
| Extract document without `[[`/`.md` | **5.7 ms → 0.003 ms** (skip parsing after precheck) | — |
| Per-document import Apply overhead | 3 SQL statements (constant); stub asserts exactly one replacement per document | Constant |

**Layout adjustment.** Initial fixed 300 ticks took 2.27 s for 1000 nodes, exceeding target. Measured 100/150/200/300 ticks and `theta` on the same machine: duration approximately proportional to ticks; `theta` 1.2 about 25% faster than default 0.9 with equal stability. Final choice: node-count-dependent fixed ticks (≤200 → 300, ≤500 → 200, otherwise 150), plus `theta` 1.2. **Deliberately no time budget**: that would make the display depend on current machine load, breaking determinism.

**Known tradeoff.** Document-page reads are O(Workspace size), not O(document links) (spec §14). Approximately 100 ms at 2 000 documents; Workspaces above 20 000 unmeasured, without guardrails—document pages on Team Workspaces at that scale would become noticeably slower. Spec §16 records an optimization path (normalized keys/indexes on the edge table).

## 4. Issues caught by tests and inspection during implementation

This section exists because every item below is a “looks complete, but is not” problem; tests capable of catching them warrant recording.

1. **Layout determinism.** Sorting nodes by id still produced different coordinates when the same graph's input order reversed. `forceLink` accumulates forces in link order. Fix: also canonical-sort/deduplicate edges. (Determinism test: forward, reverse, and repeated execution equal.)
2. **Performance assertion not actually applied.** Intended to add “exactly one index write per document” to `phase2-import-apply-perf`, but a missing blank line in the replacement pattern prevented application; the test passed without an assertion. Lint `no-unused-vars` caught the declared-but-unused variable. After fixing, **temporarily removed the hook in `projectDocument` to confirm failure**, then restored it. Same mutation verification for the new `share-link-single-exception` guard (passing `links` into share page → failure).
3. **Next 15 prefetch trap.** E2E local-graph depth switching failed roughly 1 in 8 runs: no navigation after click. Same root cause as keyboard-shortcuts spec §9—a `<Link>` to **its own current page** self-prefetches, server returns a full page, and Next 15 directly applies the first prefetch use; a race with clicking loses navigation. Fix: `prefetch={false}` for self-page links (depth, Graph/List, body wikilinks—the renderer does not know current document, so self-links also trigger it). Repeating identical local steps: **before 7/8, after 30/30**. **(Correction: 30 is too small a sample. Repeating the same test 20 times later still produced one failure; `prefetch={false}` removes one cause, not all; §9.)**
4. **E2E file ordering.** My three specs create documents in My Space, while `phase2.5-routing.spec.ts` assumes the E2E user's My Space is empty; specs run in filename order in one DB, so earlier files break it (first full e2e 104/105). `share-link.spec.ts` already depends on running later. Fix: renamed my specs to `reading-*`/`workspace-graph` and documented why in file headers. **Existing-test assumptions unchanged.**
5. **Unresolved nodes lack accessible names.** Unclickable graph `<g>` elements had only `<title>`, invisible to screen readers/`getByRole`. Fix: `role="img"` plus `aria-label`, matching clickable-node wording.
6. **Cross-document heading anchors.** `[[Note#Setup]]` navigated to another document but stayed at top: Next finished hash scrolling while content was still a Suspense skeleton, and content lives inside nested scrolling containers. Fix: scroll to the URL-hash heading after document mount (`use-scroll-to-hash`).
7. **Checkbox feedback.** Controlled checkbox waited for server response to flip, feeling like a missed click (also failing Playwright `check()`). Fix: `useOptimistic` + `useTransition` flips immediately, reconciling with response.
8. **Test-helper default parameters.** Renderer helper defaults made `render(md, undefined)` use the default, so “no resolutions” actually ran with resolutions; two failures exposed this. Replaced with two explicit helpers.
9. **Extraction escape detection.** A text node containing both `\[\[x\]\]` and a real link was misclassified by checking only whether the whole node contained `[[`. Now unescape source while recording a mask and evaluate individually; nodes that cannot align (entities/removed indentation) fall back to the coarse check “source contains no literal `[[` at all.”

## 5. Spec differences (all written back into spec)

- `getDocumentLinks` receives `revisionNo`, **not caller-provided Markdown** (spec §8.2)—service reads that revision itself under the same authorization check.
- `document.backlinks` only in palette, not row menu (spec §11), for the same reason as `document.details`.
- Local graph returned alongside `getDocumentLinks` using `localGraphDepth`, sharing directory/edge reads; `getLocalGraph` remains for future API/MCP.
- `reindex` concurrency semantics: read current revision only **after** locking the document, so writes always represent current revision, rather than “skip if stale” (plan 2.8).
- Extraction/rendering share `findWikiLinks` (spec §5); separate scans previously risked divergent clickable links and graph edges.
- Graph/backlink builders (`link-graph.ts`, `link-context.ts`) moved from slice 4 to slice 2 because services need them.

## 6. Omissions and limitations to know

- **All spec §16 follow-ups remain undone**: create documents from broken links, editor `[[` completion, Tags, Favorites/Recents, Unlinked mentions, Backlinks-query optimization, rewrite links on rename, hover previews, Daily notes, Properties panel.
- **No E2E import flow for folder-sync relative `.md` links**—integration covers them (`managedDocument` uses the importer's projection, including relative-path resolution/backlinks).
- **Document-page read scale limit** (§3): above 20 000 documents unmeasured, no guardrails.
- **Known wikilink syntax boundaries** (spec §15, all tested): `[[*x*]]` split across text nodes by emphasis is unrecognized; aliases in GFM tables require `\|`.
- **Primary-navigation self-page items** (Knowledge, Sources, Graph) still prefetch themselves. Existing pattern unchanged here; §4 item 3's mechanism applies, but no actual navigation loss observed.
- **Local E2E environment note**: `npm run test:e2e` runs `next build` in the same repo directory, overwriting active `.next`; concurrent dev/production servers may show inconsistent chunks.

## 7. Graph visual redesign (aligning Linear vocabulary)

**Scope.** Presentation only: `layoutGraph`, `GraphCanvas`, `GraphExplorer`, `GraphList`, and pure `selectVisibleLabels`. Data model, authorization, URL parameters, accessible names, and public component props unchanged. Based on repo's [design-language contract](../specs/frontend-design-language.md), with spec §10.2–§10.3 updated.

**Pre-redesign problems** (visual inspection at 1440×900 with 90-node/209-link demo data):

| Problem | Cause |
| --- | --- |
| Unlinked nodes spread around edges, enlarging the graph and shrinking its connected part | Orphans also enter `forceCenter`, positioning unrelated to graph |
| No labels on any of 90 nodes | Rule: “show all at ≤80, otherwise hovered only”; just above threshold removes every label |
| Nodes too heavy; center radius 12 | All nodes dark gray, radii 4–12 |
| Toolbar Graph/List use custom segmented controls and `shadow-popover`; canvas uses `bg-kh-bg-raised`; List has double borders | Does not use `ui/tab.ts` or follow contract surface/shadow rules |

**After redesign.** Orphans form a “Not linked · N” shelf below the graph; `selectVisibleLabels` chooses labels by zoom (90-node demo: 41 labels at initial 100%, including 7 shelf labels; two Zoom in clicks to ~169% show 67—counted actual DOM `<text>` elements rather than visually estimated). Resting nodes neutral gray, accent only on emphasized nodes; edges merged into one path; tooltip sole shadowed element; toolbar uses shared tab appearance. Individually inspected light/dark, hover, List, local graph, find highlighting + unresolved nodes.

**Tests.** unit +18 (`graph-layout` 11 → 18: shelf below connected portion, no widening, grid alignment, orphan-only bounds contain nodes, input-order independence, 60-orphan width ≤700, `nodeRadius` bounds; `graph-model` 8 → 19: `estimateLabelWidth` for Latin/CJK/mixed, `selectVisibleLabels` nonoverlap/more when zoomed/cap/**forced labels always visible and exempt from cap**/weighted priority/input-order independence). No new e2e cases; one changed assertion plus two additions: find-highlight dimming changes `opacity-30` → `opacity-25` (deliberate visual change), shelf title exists, hovered-node tooltip includes title/`1 in`. 1000-node/3000-edge layout measured 0.82–0.89 s (previously 0.91–1.04 s); difference is within same-machine measurement noise, so no speedup claimed, only **no slowdown**, still within spec §14's 1.5 s.

**Issues caught this round.**

1. **Incorrect label-test expectation.** Initially asserted “stop at cap,” counting forced labels inside cap; actual required rule is “forced always visible.” Rewrote test and added “never drop forced labels”—a behavior decision rather than accommodating implementation.
2. **One full e2e 103/105.** (a) `reading-links` rename: `getByLabel("Title")` matched two elements, one disabled. Same existing “duplicate DOM” phenomenon recorded by `phase5-authoring` (hidden form remaining after route transition); three existing specs use `page.locator("main form").first()`, while mine did not. **My test failed to follow convention**, corrected accordingly without retries. (b) `revision-history` selecting a historical revision failed to navigate to `revision=1` within 5 seconds. Existing test with no modified files shared by this change; separate rerun of two specs 8/8, then full suite 105/105. **Root cause not found**; recorded as one non-reproduced failure under full-suite load rather than fixed. If repeated, first suspect same prefetch race as §4 item 3 (Inspector self-page link).
3. **`pkill -f` killed its own shell.** Stopping demo server with `pkill -f "next start"` also matched the command line itself and killed my shell (exit 144). Switched to locating port-3000 PID via `ss` then terminating it. Tool operation only, no code impact, recorded because one rebuild appeared to fail.

**Omissions and limitations.**

- **Visual verification by inspection, without pixel-comparison regression tests.** E2E asserts structure/accessible names; color/position correctness relies on token contract (colors only at CSS-variable layer) and individual inspection.
- **Label positions estimated.** `estimateLabelWidth` uses 0.58em/1em without measuring fonts, favoring wider estimates; unusually narrow monospace fonts yield sparser labels without overlap.
- **Tooltip covers neighboring nodes.** Fixed above node (below near top edge), it obscures adjacent labels in dense regions; no pointer events, so interactions remain unblocked.

## 8. Title-row link chip and Inspector-tab memory

**Decision/rationale** in spec §11.1: Local graph stays in inspector Links rather than permanently top-right; strengthen entry point. Implementation: `link-summary.ts` (`summariseLinks`, pure), `inspector-tab-memory.ts` (`resolveInspectorTab` + guarded `localStorage` reads/writes), `document-header.tsx` (chip), `document-inspector.tsx` (selection/requests).

**Tests.** unit +9: `summariseLinks` (backlinks prioritized with total rather than list length, outgoing fallback, unresolved excluded, `null` for no links/only unresolved/read failure); `resolveInspectorTab` (default Details, remembered tab, fresh requests win, unavailable document tab falls to next option, non-tab stored values ignored). e2e +2 (`reading-links`): chip (absent without links, “1 outgoing link” for outgoing-only, “1 backlink” opens Links, **each request handled once**); memory (survives reload/document switch, explicit requests override remembered tab).

**Mutation verification.** Temporarily broke behavior for each new test, confirmed failure, then restored: (A) removing “clear request when inspector closes” fails chip assertion “selecting History does not send reader back to Links”; (B) forcing `rememberedInspectorTab()` to return `null` fails both History-memory assertions (chip final step, memory after reload). Full suite passes after restoration.

**Issues caught this round.**

1. **Stale requests override reader choice.** Initial version did not clear `requestedTab`: open Links via chip, select History, close, then Details sends back to Links because remounted `InspectorTabs` sees old request. Mutation A confirms detection; fix clears request on inspector close. Individually correct memory/request features fail only when combined.
2. **Another nonconforming `getByLabel`.** First full e2e fails `reading-outline`'s historical-revision TOC: `getByLabel("Markdown")` matches two textareas (existing duplicate DOM, documented in phase5-authoring, with `page.locator("main form").first()` convention). My **second nonconforming spec** after §7's rename; scanned all my specs and converted remaining editor operations to the same pattern.
3. **Failure not caused by this change: intermittent `workspace-graph` local-depth switch.** After clicking “2 links,” URL never becomes `graph=2`. Repeating alone 20 times with/without this change's `document-header`/`document-inspector` yields 19/20 passes, 1 failure in both, present in already-pushed commit. **Root cause later found: a hole in React ping handling, §9.** Test unchanged without masking retries.
4. **Another existing failure across two full e2e runs**: §7 item 2's occasional `revision-history` selection failure did not recur here. Also a self-page search-param click with no response, likely §9's cause, but no trace was retained then; **unverified**.

**Omissions and limitations.**

- **Chip only in document title row, not post-scroll sticky topbar.** Topbar already has Details, opening the remembered tab.
- **Memory per browser.** Another device defaults to Details; no server persistence intended (spec §11.1).
- **Details button no longer guarantees Details tab.** Deliberate (spec §11.1 “side effects”), but may break tests/docs assuming it always opens Details; existing repo tests use fresh browser contexts and are unaffected.

## 9. Root cause of intermittent local-graph depth switching: lost React ping

**Symptom.** Self-page navigation (`?graph=2`) sends RSC, receives 200 with complete body, but UI/URL stay unchanged approximately 1–5% of the time. Any unrelated React update (window focus, inspector-tab switch) commits it within 100–270 ms; without action it commits after ~30 seconds. Users see a click with no response, then another click works (second navigation takes over) or a later React update releases it.

**Ruled-out hypotheses and evidence.**

| Hypothesis | Result |
| --- | --- |
| Navigation/prefetch race (§4 item 3) | Different cause. `prefetch={false}` removes another issue; failed request here is navigation itself |
| Next action queue: navigation preemption fails to update `actionQueue.last`, orphaning a later action whose `setState(promise)` never resolves | Source-reading hypothesis **disproved by instrumentation**: queue empty at failure, no router action before click; `navigate`/`server-patch` finish normally with `discarded:false` |
| `router.refresh()` or second navigation discards it (`use-workspace-authorization`) | No refresh/second navigation at failure; access check completed ~1 second earlier |
| Request/server issue | 200 response, complete body, no server error |
| Stylesheet loading (React waits before commit) | Only one loaded stylesheet in DOM; that mechanism times out at 60 seconds, not 30 |

**Evidence chain.**

1. Failed React root: `pendingLanes` equals `suspendedLanes` (multiple transition lanes), `pingedLanes = 0`, no scheduled callback. React idle, waiting for a ping already received.
2. Any unrelated React update immediately releases it: focus → access recheck → `setState` (117–269 ms, six times); History click (91 ms). Mouse movement alone does not, since it causes no React update.
3. Without action, ~30-second commit matches access check's `setInterval(30_000)`.
4. Instrumented React ping path: **all failures (4/4) have identical final three events**—`attachPing` (Flight chunk in `resolved_model`) → same-millisecond `ping` (`wipIsRoot: true`, `exit: 4`) → `markSuspended` (`wipPinged: 0`).
5. Mechanism: Flight chunk `then()` in `resolved_model` (data arrived, not parsed) parses **synchronously**, immediately invoking callback, so `pingSuspendedRoot` runs synchronously during render. `workInProgressRootExitStatus` is 4 (suspended with delay), necessarily reached on this navigation path through Next's `use(unresolvedThenable)`. Two branches: outside render, `prepareFreshStack` restarts; **during render, do nothing** (source TODO describes this)—neither restart nor record ping in `workInProgressRootPingedLanes`. Then `markRootSuspended` clears the newly set `pingedLanes`, leaving React suspended on an already resolved thenable. Occurrence depends on chunk being precisely `resolved_model` when consumed, hence streaming timing and 1–5% frequency.

**Causal verification.** Applied upstream fix (record render-time ping in `workInProgressRootPingedLanes`) to the React chunk received by browser—Playwright rewrote a small portion in transit, **changing nothing on disk**. Same reproduction: **400 runs, 0 failures**. Same build/conditions without rewrite: **400 runs, 4 failures**; earlier batches on same build total 38/1 490 (2.6%). At 2.6%, probability of 400 consecutive passes approximately two in 100,000.

**Upstream status (downloaded tarballs compared).** Next 15.5.25/15.5.26 (latest 15.5) vendor identical React `19.2.0-canary-0bdb9206-20250818`, same buggy code. **Next 16.3.7** (`19.3.0-canary-cbb046ab-20260731`) has the verified `pingSuspendedRoot` fix, so a 15.5 patch-version upgrade does not help.

**Impact.** Any self-page navigation through delayed loading (no prefetched destination data) may trigger it: depth switching, History revision links, `includeArchived`. §8 item 4's `revision-history` failure likely shares it (unverified). Framework problem rather than feature-specific; this feature happens to expose an easily tested entry point.

**Options and decision.** Adopt option 1 (Disposition below).

1. **Apply upstream line to 15.5.25 using patch-package** (`react-dom-client.production.js`, same development location too). Verified, tiny, remove on Next 16 upgrade. Cost: new patch-package dependency/postinstall and vendored-code modification.
2. **Upgrade Next 16.x**: includes fix, but major upgrade unjustified solely for this bug.
3. **Leave as known issue**: depth-switch e2e (possibly `revision-history`) fails 1–5%; users sometimes click twice.
4. **Control-specific fix**: client-state depth switching (server returns both depths/layouts at once), eliminating navigation and making switching instant. Fixes one entry only; other self-page navigation remains at risk, and shareable `?graph=2` needs separate handling.

Recommendation matched final decision: do 1 first, then 2 during normal upgrades and remove patch; not only 4.

**Practices retained from investigation.**

- Reproduction tool: `scripts/diagnostics/router-stuck-transition.ts` (§11). No modifications needed—directly reads React root lanes to classify “idle on lost ping,” optionally inducing unrelated update to confirm release. For fixes/Next upgrades, 400 runs are more reliable than chance E2E failures.
- Instrumentation beats reasoning: action-queue orphan hypothesis looked fully plausible in source but was disproved by one instrumented line.
- Webpack persistent cache treats `node_modules` as immutable: two rebuilds after editing those files had no effect until clearing `.next/cache`.

**Disposition: patch-package applies upstream line.**

- `patch-package` (dev dependency, 15 development-only transitive dependencies; 7 existing `npm audit` issues unchanged after addition, none in its dependencies) + `postinstall: patch-package` + `patches/next+15.5.25.patch`.
- Patch records ping in `pingSuspendedRoot`'s render-time branch across 4 builds: `react-dom-client.production.js` (`next build`/`start`), `react-dom-client.development.js` (`next dev`), `react-dom-profiling.profiling.js`, `react-dom-profiling.development.js` (`--profile`). Textually identical in shape to Next 16.3.7's bundled React fix. **No** `react-dom-experimental` patch: selected only with Next experimental flag, absent in this app.
- Generated through patch-package's own flow against clean `next@15.5.25`, so patch contains only those 4 files, also proving all other restored files remained original.
- **Guard test** `tests/unit/vendored-react-ping-fix.test.ts`: checks bundled React records ping in two `pingSuspendedRoot` locations. Verifies **source behavior**, not patch-file existence; a newer Next with fixed React passes naturally, permitting deletion. Catches missing patch from `npm ci --ignore-scripts` and outdated patch after upgrade. Actually fails in clean unpatched checkout (one production, one development failure, messages explaining remedy).
- Intentional version binding: filename includes `15.5.25`, so Next upgrade makes old patch-package fail, requiring review instead of silently retaining an invalid patch. README explains handling.

**Disposition verification (all in clean checkouts, without touching this repo's `.next`/cache).**

| Item | Result |
| --- | --- |
| Clean-checkout `npm ci` | `postinstall` applies patch, all 4 builds fixed; patch-package rerun idempotent; bit-identical to primary-repo files (checked twice) |
| Shipped bundle | Minified code in both React copies (app chunk/framework chunk) has fixed shape; control has unfixed shape |
| Uninstrumented production build, reproduction script 400 times | **Patched: 0 failures**; **unpatched control (same process/clean-checkout build): 12 failures (3.0%)**, all classified “React idle on lost ping,” all released by unrelated updates within 142–361 ms. At 3.0%, probability of 400 passes approximately five in a million |
| Complete e2e (patched clean checkout) | 107/107 |
| Previously failing depth-switch case, repeated 40 times | 40/40 (unpatched 19/20, §8 item 3) |
| Unit/typecheck/lint (primary repo) | unit 620/620 (including 3 guard tests), clean `tsc --noEmit`/`eslint .` |

**Environment notes and omissions.**

- Temporary investigation logs in `node_modules/next`/vendored React restored from prior backup (4 files, verified bit-identical). Subsequent patch applied to restored clean files.
- **This repo's `.next/cache` still contains instrumented React compilation, and `.next` is currently an instrumented build** (permission classifier blocked my cache-cleaning command; no workaround attempted). Consequently `npm run build` in this directory reuses cache, **omitting** the patch and retaining logs. CI/clean checkouts unaffected (verification above uses clean checkouts). Clear `.next/cache` and rebuild; README also says to clear cache after adding/removing patches.
- This patch fixes one bundled-framework bug; it does not guarantee depth-switch e2e is forever stable (requires no other flaky sources), but removes the known source: reproduction 400/0 failures, case 40/0. Whether §8 item 4's `revision-history` failure shares this cause remains unverified; if repeated, inspect React root using the reproduction method.

## 10. Rebase onto main (document composer, #62)

`origin/main` gained one commit after this branch began: #62, shared create/edit composer (42 files, 10 overlapping this branch). Rebased 13 commits onto it; local `backup/pre-rebase-531a0d7` preserves pre-rebase state.

**Conflicts and resolutions** (5 of 13 commits conflicted; others auto-merged):

| File | Changes on each side | Resolution |
| --- | --- | --- |
| `markdown-renderer.tsx` (two commits) | Main extracts prose class into `MARKDOWN_PROSE`; my changes add heading-anchor `scroll-mt-4` and wikilink remark plugin import | Preserve main structure, move `scroll-mt-4` into `markdown-prose.ts` constant (composer rendered editor shares it, with harmless heading scroll margin); retain both imports |
| `document-viewer.tsx` | Main extracts shared reading/composer-preview `MarkdownArticle`; my viewer accepts `links` | Both `MarkdownArticle`/`DocumentViewer` accept `links`. Draft has no link resolution, so preview links remain text until saving |
| Document `page.tsx` | Main moves breadcrumb to `documentLocation`; my `buildBreadcrumb`'s two type imports no longer needed | Retain `documentLocation`/`getDocumentLinkModel`, remove two unused type imports |
| `package.json`/`package-lock.json` (two commits) | Dependencies added independently: `@milkdown/kit` versus `d3-force`; `jsdom` versus `patch-package` | Retain both package.json changes. **Do not manually merge lockfile**: second attempt used main lock and npm restored patch-package, adding only 216 lines without deletions. `npm ci` accepts merged lock |
| `README.md` | Both add document-table rows | Retain both |

**Auto-merged but requiring verification**: both changed title row/inspector (main breadcrumb/edit entry; mine chip/tab memory). No Git conflict, so only tests establish combined correctness: chip/tab-memory e2e pass.

**Required adjustment**: my three e2e specs (`reading-links`, `reading-outline`, `workspace-graph`) create documents with the old “Document title”/“Content” form replaced by composer. After rebase, 13 tests fail with 30-second timeouts, rather than assertion failures, due to missing fields. Converted to main-spec convention (`main form`, exact `Title`, `showMarkdown` then enter source Markdown), changing no assertions. Independent commit, **not folded into earlier commits**, so intermediate post-rebase commits have failing e2e (unit/typecheck/lint green); verified at whole-branch level.

**After rebase** (`npm ci` reinstall, clean build): unit 735 (my 620 plus main), integration 486, e2e **145/145** (4.3 minutes), clean `tsc --noEmit`/`eslint .`/`next build`; `postinstall` applies React patch (§9).

**Later discovery: this all-green result omitted rendered mode.** Converting three specs to `showMarkdown` made them work on the new form but bypassed composer's default rendered editing (Milkdown). The rendered editor serializes `[[wikilink]]` as `\[\[…]]`: editing/saving a linked document in rendered mode changes its index from 1 link to 0 (also `[[Note|alias]]`, `[[Note#Setup]]`, list wikilinks), losing backlinks/graph edges. `[text](note.md)` unaffected. #62 and #78 work separately but fail together; 145/145 misses this because no e2e writes/edits wikilinks in rendered mode. Fix/testing policy (any editor-affecting change needs rendered-mode tests) is in [personal daily-driver design §1.1](../specs/2026-09-29-personal-daily-driver-design.md), slice 0 of that plan.

## 11. Reproduction

```bash
make db-up && make db-migrate && make db-reindex-links   # Existing DB: backfill index after migration 012
make verify                                             # unit + typecheck + lint + build
make test-integration                                   # Requires MariaDB
make browsers && make test-e2e                          # All e2e; one spec: npm run test:e2e -- tests/e2e/workspace-graph.spec.ts
npx tsx scripts/diagnostics/router-stuck-transition.ts 100   # §9: requires running production build; multiple instances allowed
```
