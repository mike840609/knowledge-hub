# Personal Daily Driver (First Batch) — Verification Record

Corresponds to [design spec](../specs/2026-09-29-personal-daily-driver-design.md) and [implementation plan](../plans/2026-09-29-personal-daily-driver.md). Add a section after each slice: test counts, measurements, **mutation verification deliberately breaking behavior to confirm test failure**, and faithfully recorded failures/deviations.

Currently includes slice 0, slice C, and slice A-1.

## Slice 0 — Editor understands wikilinks

**Problem fixed.** Composer's default rendered editor (Milkdown) writes `[[X]]` as `\[\[X]]`, which is not a link. Editing/saving a wikilink document in rendered mode changes its index from 1 link to 0, losing backlinks/graph edges; typing `[[X]]` in rendered mode also fails to save a link. `[text](note.md)` unaffected.

**Branch:** `claude/wikilink-editor-slice0`, from `main` (`87a21d4`).

| Task | commit | Changes |
| --- | --- | --- |
| 0.2 | `74e88e0` | Extractor rule table becomes shared fixture list `tests/fixtures/link-markdown.ts` (32 entries, 13 corresponding to existing assertions, 19 new) |
| 0.3 | `50a28a7` | Remark plugin; reader/editor share `replaceWikiLinks` |
| 0.4, 0.5 | `419c916` | `wiki_link` node, input rule for typing `]]`, paste handling, serialization handler |
| 0.6 | `dd9477d` | Connect to `editor-core.ts` |
| 0.7 | `15f78e3` | Round-trip tests, 137 cases |
| 0.8 | `1e05c0b` | Display styling |
| 0.9 | `781ac28` | 5 rendered-mode browser tests |
| 0.10 | `9f50cd8` | Read-only damaged-document report |
| 0.11 | (this commit) | Documentation |

### Results

| Check | Before (main) | Now |
| --- | --- | --- |
| Unit tests | 735 (record after #78 rebase) | **968** all passed |
| integration | 486 | **493** all passed |
| e2e | 145 | **150** all passed |
| `tsc --noEmit`, `eslint .` | Clean | Clean |
| `next build` | Successful | Successful |

233 added unit tests: +20 from data-driven extractor, remark plugin 17, node 23, +1 wikilink case in `markdown-editor.test.ts` (one escaped case becomes two unchanged cases), round trips 137, damaged-report detector 35. 7 added integration tests cover report script. 5 added e2e are `zz-wikilinks-composer.spec.ts`.

### Red on unfixed main (task 0.9 requirement)

Created a git worktree at `main` (`87a21d4`), copied new e2e spec and ran: **all 5 fail** at node assertions (main has no such node). Also ran a minimal edit/save-only version to observe the actual defect:

- Saved PATCH: `"Intro line. (edited)\n\nSee \\[\\[Target mune44f9]] for details.\n"`, i.e. `\[\[…]]`.
- After saving, target document's backlink block **disappears** (before: “Linked from 1 document”).

This is end-to-end D0 evidence on the real app/database.

### Mutation verification

Each guard deliberately broken once to confirm failure, then restored and all-pass confirmed (`cmp` bitwise comparison against original).

| Broken behavior | Tests catching it |
| --- | --- |
| Shared traversal enters code/links (skip set removed) | 2 (1 new, 1 existing reader) |
| Shared traversal drops text before link | 7 (5 new, 2 existing reader) |
| Input rule ignores `!`/backslash guards | 2 |
| Paste ignores destination | 2 (code block, inline code) |
| Splitter ignores backslash | 1 |
| Editor lacks node/remark plugin | 114 (of 186 combined round-trip/existing `markdown-editor.test.ts` tests) |
| Editor omits stringify settings | 118 |
| Remove only `text` handler wrapper | 8 (escape cases) |
| Remove only restoration of table `\|` | 7 (table alias cases) |
| Report: scan not read-only | 1 |
| Report: include partial escapes such as `\[\[x\]]` | 1 unit, 1 integration |
| Report: inspect all revisions rather than current only | 1 |
| Report: read first batch only | 1 |

**One mistake of my own in this table.** First attempt to mutate “report includes partial escapes” with `sed` changed nothing (line unchanged), yet all tests passed—meaningless result. Repeated exact string replacement caught by unit but not integration: its deliberately escaped fixture used `\[\[literal\]\]`, unmatched with/without the rule. Added `\[\[half\]]` to that fixture; integration then caught it too.

### Measurements

| Item | main | Branch |
| --- | --- | --- |
| Total static JS (`.next/static/chunks`, 78 files) | 1,820,392 bytes | 1,823,219 bytes (+2,827, +0.16%) |
| Same, gzip (concatenated then compressed) | 546,799 | 549,212 (+2,413) |
| Total lazy chunks (`<id>.<hash>.js`) | 256,625 | 258,860 (+2,235) |
| Chunk containing `editor-core` | 8,056 raw / 3,487 gzip | 10,288 raw / 4,429 gzip |
| `/edit` First Load JS | 170 kB | 169 kB |
| `/new` | 171 kB | 170 kB |
| Document page | 191 kB | 190 kB |

Expected single-digit KB, measured +2.8 KB. First Load JS differs by 1 kB in both directions without increasing; the 1 kB reduction was not investigated, probably chunk grouping rather than savings, and should not be treated as a benefit.

Damaged-document detector (`findEscapedWikiLinks`) cost: synthetic documents approximately 2.4 ms/KB, roughly linear (1.2 KB 3.8 ms, 5 KB 12 ms, 20 KB 54 ms, 100 KB 292 ms, all containing many damaged links). Runs only on SQL-preselected documents containing `\[\[`. **Synthetic-input measurements, not real data.** Local dev DB has 145 documents and reports 0 candidates; `hcm_km_big` has only 90 small documents, not a large-scale test; no real large dataset available.

### Issues caught by tests/inspection during implementation

1. **Spike:** mdast `html` output writes table `[[Note\|alias]]` as `[[Note|alias]]`, splitting cells and changing edges 1 → 0. Switched to custom node/handler.
2. **Another existing main defect (D0b):** Milkdown `text` handler does not escape text ending with whitespace and containing no `*`, `_`, `\`, so deliberately escaped `\[\[lit\]\] and ![a](/a.png)` already becomes a real link on main. Fixed only `[[` cases; analogous other Markdown characters unchanged.
3. **Pastes into code blocks converted to links (my mistake):** `transformPasted` checked content only; pasted code text lacks outer code-block wrapper there. Unit test caught it; now checks destination. Inline-code end is outside its noninclusive mark and requires stored marks, also caught by tests.
4. **jsdom limitations:** no `ClipboardEvent`, no reflected `contentEditable`, arrow handling needs coordinate measurement (`getClientRects` absent). First two patched in tests; arrow behavior moved to browser tests.
5. **E2E filenames broke two graph tests consecutively (my mistake):** first created linked documents in fixed empty workspace, breaking `workspace-graph.spec.ts`'s “nothing is linked.” Second moved to My Space with earlier filename; six documents changed graph geometry, causing `workspace-graph.spec.ts:44` node hover to hit canvas (“svg intercepts pointer events”). Fixed with `zz-…` filename running last, documented in header.
6. **Damage detector:** initially skipped link text, but test input was not a link (first unescaped `]` ends link text); old editor escapes both sides inside links, so that form never occurs. Dead code removed. Two existing deliberately escaped fixtures found more than expected—not detector error: **shape cannot distinguish deliberate escaping from damage**; intentional `\[\[x\]\]` also becomes `\[\[x]]` through old-editor save. Tests now lock down this fact rather than pretend to distinguish.
7. **My incorrect numbers:** early spec draft had two unmeasured counts (“26 entries,” “14 entries”); actual 31 entries/48 tests, corrected before commit. Plan once listed lazy-chunk increase 2,232; actual 2,235, corrected.

### Spec deviations (all written back into spec/plan)

- Paste: editor has no Markdown paste parser; spec's claim it passes through one was wrong (spec §4.1-4).
- Click: ⌘/Ctrl-click cannot follow links as spec claimed because editor has no resolution directory; any click selects node only (spec §4.1-5).
- Extractor/reader/editor share traversal; text nodes without `position` use value only, matching reader (plan 0.3).
- Arrow keys: **no assertions**. Chromium behavior differs by sequence: some first select the link then cross on another press; others cross directly. Backspace stable: once immediately after link deletes entire link, Ctrl+Z restores.

### Not done or not proved

- **Existing damaged documents not repaired.** Deliberate decision (report first); script ready: `make db-report-escaped-wikilinks`. **Unknown how many exist in your real data**; local 0 says little. Report lists candidates, not conclusions.
- Chromium only; no Firefox/Safari. New editor lookbehind regex (`(?<![!\\])…`); extractor already had one in #78. General knowledge suggests Safari before 16.4 lacks support, but **unverified**, and supported browsers unknown; please confirm.
- Dark mode: tokens exist in both themes, but tested only default theme without separate visual inspection.
- Typing after selecting link replaces it (Ctrl+Z restores). Standard ProseMirror behavior for selectable atomic nodes, unchanged; user decision whether to handle it.
- Existing fragility unrelated/unchanged: `workspace-graph.spec.ts:44` hover depends on layout; CI `row-actions.spec.ts:74` failed once in #79 and passed on identical-code rerun, cause unconfirmed.

### Reproduction

```bash
make verify                                              # unit + typecheck + lint + build
make test-integration                                    # Requires MariaDB
make browsers && make test-e2e                           # All e2e, including zz-wikilinks-composer
make db-report-escaped-wikilinks                         # Read-only: documents possibly damaged by old editor
npx vitest run --config vitest.config.ts tests/unit/editor-wikilinks.test.ts
```

## Slice C — Code blocks

**Changes.** Fenced code on reader/share pages gets syntax coloring and copy buttons. Composer's rendered editor and pre-load stand-in remain unchanged (no coloring/buttons).

**Branch:** `claude/code-highlight-slice-c`, from `main` (`7d2697e`).

| Task | commit | Changes |
| --- | --- | --- |
| C.1 | `02519ee` | Dependencies and measured language set written into spec |
| C.2 | `6789b46` | Highlight configuration module (first version with `rehype-highlight`; rewritten C.7) |
| C.3 | `22243d2`, `908a857` | Eight syntax tokens/contrast guards; fix Tailwind rule removal |
| C.4, C.5 | `d8d68bd` | Split renderer into `MarkdownBase`/`MarkdownRenderer`/`MarkdownArticle`, copy button |
| (docs) | `35bfc39` | Spec/plan updates for C.1–C.5 |
| C.6 | `f992f57` | E2E, 5 cases |
| C.7 | `7c1e4ce` | Custom highlight plugin: whole-document budget, nesting-depth cap; remove `rehype-highlight` |
| (small fix) | `c8c2cb6` | Hide copy button in print |

### Results

| Check | Before (main) | Now |
| --- | --- | --- |
| Unit tests | 968 | **1057** all passed |
| e2e | 150 | **155** all passed (`npm run test:e2e`, 4.3 minutes) |
| integration | 493 | **Not rerun locally**: no DB-related code changed in this slice; CI will run |
| `tsc --noEmit`, `eslint` | Clean | Clean |
| `next build` | Successful | Successful |

89 added unit tests: highlight module 39, syntax colors 33, reader code blocks 14, composer bundle guards 3.

### Red on defective version (C.6 requirement)

All 5 e2e cases passed initially, so reran against deliberately broken version: **restore CSS with Tailwind-deleted rules** (`d8d68bd` state), and **remove copy-button trailing-newline handling/`catch`**. Result 4 red/1 green at expected assertions:

| Case | Failed assertion |
| --- | --- |
| Reader colors | Keywords use body `rgb(29, 31, 36)`, not token `rgb(138, 47, 168)` |
| Exact copied text | Clipboard has extra newline |
| Clipboard denied | No “Could not copy” |
| Share page | Keyword color equals body |
| Composer uncolored | **Green**—mutations cannot affect it. Asserts intended behavior without catching stand-in flashing color; that regression guarded by unit `composer-bundle` import checks/spec, without browser test |

### Mutation verification

Each guard deliberately broken once, failure confirmed, restored/all-pass confirmed (`cmp` bitwise original comparison).

| Broken behavior | Tests catching it |
| --- | --- |
| Remove per-block cap | 2 |
| Off-by-one cap (`<=` → `<`) | 1 |
| Remove `dockerfile` from language set | 3 |
| Language detection (`detect: true`, first plugin) | 2 |
| Mark all later blocks plaintext after exceeding cap (first plugin) | 1 |
| Remove whole-document budget | 4 |
| Depth-rejected blocks do not consume budget | 1 |
| Remove depth check | 4 (including rust/swift crashes) |
| Remove grammar-exception `try/catch` | 1 |
| Ignore `no-highlight` | 1 |
| Pale comments (insufficient contrast) | 1 |
| Dark theme missing a token | 5 |
| Hardcoded rule colors | 2 |
| Keyword rule uses different token | 1 |
| Two tokens same color | 1 |
| Remove `built_in` rule | 1 |
| **Wrap rules back in `@layer` (Tailwind deletes them)** | **Only 1 (compiled-stylesheet test)**; other 32 pass |
| Reader omits highlight plugin/copy button/button render, or renders button inside `<pre>` | 1/2/2/2 |
| Composer stand-in touches reader renderer / `MarkdownBase` imports highlight module | 2 each |
| Remove `print:hidden` | 1 |

**Table oversight:** first language-detection mutation was not applied (pattern also in comment, blocked by precheck); caught after repeating.

### Measurements

Same machine/method, separate build of `main` (`7d2697e`) in git worktree as baseline.

| Item | main | Branch |
| --- | --- | --- |
| Total static JS (`.next/static/chunks`, 78 files both sides) | 1,823,118 bytes | 1,827,782 (+4,664, +0.26%) |
| Same, gzip (concatenated then compressed) | 549,055 | 550,407 (+1,352) |
| Document-page client JS (`app-build-manifest` files) | 607,044 raw / 184,413 gzip | 608,304 (+1,260) / 184,430 (+17) |
| `/edit` | 561,701／167,257 | 561,845（+144）／167,191（−66） |
| `/new` | 562,923／167,721 | 563,068（+145）／167,641（−80） |
| Share page `/s/:token` | 366,965 / 107,751 (6 files) | 379,893 (+12,928, +3.5%) / 112,260 (+4,509) (7 files) |
| First Load JS, build output | Document 191, `/edit` 170, `/new` 171, share 109 kB | 190, 169, 170, **114** kB |
| Client files containing lowlight/`hljs-`/`registerLanguage` | 0/80 | **0/80** |
| Server files containing them | 0/103 | 1/103 |

**Interpreting these numbers.**

- **Highlighting enters no client bundle**: none of 80 client files, exactly one server file. Purpose of separating `MarkdownBase`/`MarkdownRenderer`.
- **Reader client JS +1.26 KB raw (gzip +17 B)**—plan expected 0, but copy button is client island. Gzip barely changes because needed components already exist on page.
- **Composer pages +144/+145 raw bytes**: not investigated; only hundreds of bytes, no highlighting (previous row proves no client lowlight).
- **Share +12.9 KB raw, First Load +5 kB**: previously no interactive components; copy button first loads button/dependencies. Individual modules not investigated. Largest reader-facing client cost of slice.
- **First Load ±1 kB** (190/169/170 versus 191/170/171, shared 103 → 102) matches slice 0: chunk grouping, not savings; do not treat as benefit.

### Rendering cost (server, measured)

`renderToStaticMarkup` compares uncolored `MarkdownBase` with colored `MarkdownRenderer`; medians. Documents repeat platform-language examples into specified block sizes; **synthetic input, not real documents**.

| Document | Uncolored | Colored | Increase | Increase without budget/depth cap |
| --- | --- | --- | --- | --- |
| 20 KB runbook (10 blocks) | 33 ms | 119 ms | +86 ms | Unmeasured (within budget, should match) |
| 1 MB (200 blocks of 5,000 characters) | 1,488 ms | 1,911 ms | **+422 ms** | +4,876 ms |
| 4 MB (200 blocks of 19,999 characters) | 5,848 ms | 6,353 ms | **+505 ms** | +22,783 ms |

Real code approximately 5 ms/KB: 20,000-character C table 113 ms, INI 102 ms, SQL 102 ms, Python 98 ms.

**Pathological input.** 40 languages ×18 inputs (repeated quotes, backslashes, `/*`, `<`, parentheses, `$(`, numbers…) at 19,999 characters: **0 exceptions** (2 before fix: rust/swift `/*`). Worst single block **1,892 ms (`ini`, repeated numbers)**, then arduino 1,670, cpp 1,542, c 1,490, csharp 1,387 ms. Nonlinear: ini numbers 2,500 chars 38 ms, 5,000 122 ms, 10,000 488 ms, roughly ×4 per doubling. 20,000-character cap bounds worst block near 2 s; whole-document 100,000-character budget permits ~5 such blocks—**estimated worst ~10 s, extrapolated from one-block measurements, not end-to-end measured**. Tighten `MAX_HIGHLIGHT_CHARS`: 10,000 gives worst ~0.5 s/block. 20,000 is the user-defined spec §5 number, unchanged; real code at that size cheap (~100 ms), cost only in deliberate pathological inputs.

### Issues caught by tests/inspection during implementation

1. **Tailwind deletes rules (my mistake, most important).** Syntax rules inside `@layer components`; Tailwind removes layered rules whose class names never appear in `src`, while highlight.js produces `hljs-*` at render time. Compiled CSS has no `.hljs-*`, only `--kh-syntax-*` definitions. Code uncolored despite correct source/tests reading raw CSS; discovered while preparing e2e by checking compiled output. Moved outside `@layer` (existing `.kh-select` pattern) and added test compiling styles with repo Tailwind config before checking.
2. **No `hljs-code` rule.** Test requiring every emitted scope colored or intentionally uncolored caught it immediately: Markdown fenced inline code emits it.
3. **Rust/swift nested comments fail whole-page render (found measuring).** `/*` repeated 10,000 → 10,000 `<span>` layers → `RangeError: Maximum call stack size exceeded`. 3,000 throws while 5,000 sometimes does not (JIT warmup), so cannot assume rarity. `rehype-highlight` recursively traverses generated output, preventing limits; replaced with custom plugin.
4. **No whole-document budget (found measuring).** See table; 5 MB document cap gives worst unbudgeted overhead around +28 s.
5. **First bad-grammar test tested wrong thing (my mistake).** Grammar threw at registration, but highlight.js swallowed it/printed `console.error`; `registered()` false, plugin never reaches `try/catch`, leaving path untested. Extra `Error: boom` on stderr exposed this. Replaced with successful registration but first-use `SyntaxError` (invalid regex).
6. **First e2e failed because DB was not running** (MariaDB not restarted after container restart), rather than test failure.
7. **Two incorrect assertions of my own:** raw HTML becomes text, so `onclick` appears in text (assert elements/attributes instead); `<pre>` has a class.
8. **Plan C.5 contradiction:** “composer shares preview” conflicts with spec §5 (no composer highlighting); follow spec.
9. **Spec D4's zero client JS false:** copy button is client island; rewritten.

### Spec deviations (all written back into spec/plan)

- Replace `rehype-highlight` with custom rehype plugin directly using lowlight (spec D4/§5; issues 3/4 above).
- Added whole-document 100,000-character budget and nesting-depth cap 50 (spec §5 limits). These are my additions rather than user decisions, affecting only extreme inputs.
- Per-block cap counts characters including Markdown's trailing newline (original spec said “20 KB”).
- Copy reads `<pre>` `textContent` at click time rather than passing prop (original spec said from hast); button always visible instead of hover-only.
- Split into `MarkdownBase` for composer without highlighting/buttons and reader `MarkdownRenderer`; composer stand-in uncolored (plan C.5 previously shared it).
- Measured language set differs from spec recollection: `common` has 37 languages, excluding `dockerfile`/`groovy`/`protobuf`; lacks Spring `properties`, `nginx`, `scala`, `gradle`; §12-5 decides not to add, only record.

### Unproved areas

- **Dark theme colors verified, not visually inspected.** E2E confirms computed keyword color equals dark token and differs from light; ≥4.5:1 contrast calculated, actual screen unseen.
- **Chromium only**; copy untested in Safari/Firefox. Missing clipboard in insecure contexts simulated with stub, not real HTTP deployment.
- **No screen-reader testing.** Assertions cover `aria-live="polite"`/button names, without listening with real reader.
- **Print checks class output only** (Tailwind compilation/unit assertions), no print preview.
- **Synthetic rendering-cost input.** No real large documents; worst ~10 s extrapolated.
- **Intermittent `row-actions.spec.ts:74` unrelated to slice**; passed this full run; diagnosis/proposed fix in #79 comments.

## Slice A-1 — Organize/archive: folders, archive/restore, create documents in folders

**Changes.** Folder/document tree rows gain right-click/`⋯` menus: create folders, rename, archive/restore documents/folders with Undo, create documents within folders. Services already exist; slice adds HTTP routes, registry entries, Web access. Move/reorder (“Move to…”, `Alt+↑/↓`) are A-2.

**Branch:** `claude/organize-archive-slice-a1`, from `main` (`2190e77`, after C).

| Task | commit | Changes |
| --- | --- | --- |
| A1.1 | `9b77326` | Tree/folder errors receive status mappings (no longer 500) |
| A1.2 | `6a62100` | Parse create/rename folder and document `parentId` |
| A1.3 | `baa5786` | Routes and 54 integration tests |
| A1.4 | `261804c` | Registry: document archive/restore, folder actions, Create folder |
| A1.5–A1.7 | `719245c` | Client actions, folder menus, name dialog, `?folder=` |
| A1.8 | `a143e27` | 9 e2e cases plus fixes for three implementation issues caught |
| A1.9 | (this commit) | Docs/verification record |

### Results

| Check | Before (main) | Now |
| --- | --- | --- |
| Unit tests | 1057 | **1198** all passed |
| integration (`npm run test:integration`, local) | 493 | **547** all passed (+54, `organize-api.test.ts`) |
| e2e (complete, `npm run test:e2e`, 4.9 minutes) | 155 | **164** all passed (+9, `zz-organize.spec.ts`) |
| `tsc --noEmit`, `eslint` | Clean | Clean |
| `next build` | Successful | Successful |

141 added unit tests: error mappings 8, input parsing 20, registry 83 (including two complete 32-cell matrices), messages 18, access rechecks 12.

### Mutation verification

Each guard deliberately broken, failure confirmed, restored/all-pass confirmed (`cmp`).

| Broken behavior | Tests catching it |
| --- | --- |
| Remove each of six error codes from mapping list | 1 each |
| Skip ID/parentId validation, name normalization, length cap, count before trim, skip path-ID validation | 1/4/4/2/1/1 |
| Route ignores sourceId/workspace relationship | 1 (**initial test missed it**: nonmember already gets service 404; added caller belonging to both workspaces) |
| Route ignores parentId (folder/document) | 5/4 |
| Archive backlink count always 0, archived source hidden as 404, no workspace-ID validation | 1 each |
| Registry skips ownership (document/folder), restore ignores source status, folder actions ignore status, rename enters palette, Create folder enters empty state, link gets archive suffix, Archive first | 5/3/2/2/1/2/1/1 |
| Messages always show link count, no name trim, length off-by-one, default swallows server message, nonempty explanation lacks next step | 1–2 each |
| Access recheck: each of six codes removed from exclusion list, remove early return | 1 each / 6 |
| E2E: archiving open document does not navigate | Case 4 |
| E2E: `document.archive` ignores ownership | Case 9 |
| E2E: tree 409 triggers access recheck | Cases 7/8 (**initial assertion ineffective**, below) |

### Implementation issues caught writing E2E (my mistakes, fixed)

1. **Tree 409 pauses shell.** `requestWorkspaceAccessCheck` rechecks all 409s, suspending writes and flashing “Unable to confirm workspace.” Nonempty-folder refusal is common here, flashing every time. Codes describe content rather than permissions, like `REVISION_CONFLICT`, so excluded. **Initial “Unable to confirm workspace absent” assertion ineffective**—quick successful recheck ends flash before assertion; removing fix leaves 7/8 green. Now listens to `kh:workspace-access-check`, asserts 0 events, turning red on mutation.
2. **Undo toast disappears after archiving open document.** Assumed `router.push` changes path once; temporary debug spec recorded URL/toast every 250 ms, showing **two** changes: list `/knowledge/:source`, then server redirect to first document. One-navigation survival blocked only first. Now survives navigation within 3 seconds after toast's own action.
3. **Sidebar stale after list navigation.** Redirect destination mismatches `refreshOnArrival` target. Added `refreshOnArrivalElsewhere` (refresh first arrival after leaving this path), and `useRefreshOnArrival` in knowledge layout (empty state after final-document archive lacks document pane).

### Other errors during development

- **Expected read-only member 403, actual 404.** Write path follows Phase 1 contract (no `document.write` → hidden `WorkspaceAccessDeniedError` 404), same as existing document writes. Changed assertion to refusal/no mutation; rationale in header/spec §7.5.
- **`&&`-chained commands did not stop on `tsc` failure**, committing a type error; folded correction into unpushed commit.
- **Standalone E2E assumed My Space already had documents** (prior suite specs create them); empty workspace lacks sidebar. Each case creates a document first, avoiding prior-spec dependence.
- **Local MariaDB died after container restart**, restarted twice (not test issue).

### Measurements

Next build output (±1 kB grouping error, slice 0):

| Page | After C | A-1 |
| --- | --- | --- |
| Document First Load JS | 190 kB | **194 kB** (+4) |
| `/edit`、`/new` | 169、170 kB | 170、171 kB |
| Graph/share | 119, 114 kB | 119, 114 kB (unchanged) |

+4 kB from knowledge layout carrying folder-name dialog/`use-tree-mutations`; shared client layout makes document pages pay. Composition not investigated.

### Spec deviations (written back into §7.5/plan)

- Read-only response 404, not 403 (above).
- Create-folder entry is a separate button beside Notes-row `+`, not a `+` menu; empty workspace lacks sidebar, so only palette creates folders before first document.
- Copy: spec originally Chinese toast/errors; user decision 2026-09-30 changed menus/dialogs/toasts/errors consistently to English in `organize-messages.ts`. Old Chinese composer/upload-encoding copy unchanged.
- Added toast `survivesNavigation`; `GovernanceError` renders tree codes in plain language.
- Tree expands current-document ancestors (unspecified, needed to show newly created in-folder document).

### Unproved areas

- **No visual inspection.** Archived rows (Archived/secondary text), folder-header hover/`⋯`, light/dark dialogs only covered by E2E attribute assertions; screens unseen.
- **Folder keyboard checks only `⋯`** (focus then Enter). Row is treeitem while menu attaches to header, so ContextMenu/Shift+F10 on row does not open it; keyboard entry is `⋯`. Touch long-press untested.
- **Only one two-tab race**: folder archived while create page open (`zz-organize` case 8). Other sequences (two tabs archive same document) rely on service idempotency, integration-tested but not browser-tested.
- **Restore refusal with archived parent** lacks browser E2E; integration/`organizeFailure` unit tests cover halves.
- **Chromium only.**
- **Performance unmeasured:** `buildKnowledgeTree`/ancestor-expansion effect with many folders/large tree.
- No screen-reader run; existing toast `aria-live` area used.

## Slice A-2 — Move/reorder: “Move to…” dialog, palette Move document…, Alt+↑/↓

**Changes.** Tree document/folder menus gain Move document…/Move folder…, opening dialog listing source folders/root; selection appends at destination. Palette offers Move document… for open document; focused-row Alt+↑/Alt+↓ moves one sibling position. `moveTreeNode`/`reorderTreeNode` services already exist; slice adds `PATCH /api/tree-nodes/:id` move/reorder shapes, registry/Web entries.

**Branch:** `claude/organize-move-slice-a2`, from `main` (`7aedcd4`, after A-1/#83).

| Task | commit | Changes |
| --- | --- | --- |
| A2.1 | `6510eca` | Three PATCH shapes/27 integration tests |
| A2.2–A2.4 | `e0239a2` | Registry/dialog/tree Alt+↑/↓, jsdom/E2E |
| A2.5 | `28d95d8` | Docs/verification record |
| — | (this commit) | Mixed folder-sync scenarios (6 integration cases) |

### Results

| Check | Before (main) | Now |
| --- | --- | --- |
| Unit tests | 1198 | **1276** all passed |
| integration (`npm run test:integration`, local) | 547 | **580** all passed (+33: `organize-api.test.ts` +27, `sync-and-organize.test.ts` +6) |
| e2e (complete, `npm run test:e2e`, 5.6 minutes) | 164 | **177** all passed (+13, `zz-organize-move.spec.ts`) |
| `tsc --noEmit`, `eslint` | Clean | Clean |
| `next build` | Successful | Successful |

78 added units: registry +37 (one 32-cell matrix), body parsing +14, tree reorder jsdom 14, `moveDestinations`/`reorderStep` 10, messages +3.

### Mutation verification

Each guard deliberately broken, failure confirmed, restored/all-pass confirmed (`cmp`).

| Broken behavior | Tests catching it |
| --- | --- |
| Route move ignores parentId/position, reorder ignores position, rename changes name (control) | 9/3/2/1 integration |
| Body: null parent not move, default first rather than last, name+position allowed, position -1 accepted | 1/2/1/1 |
| `reorderStep` uses neighbor screen index rather than stored position | 1 (randomized real-service test; **initial version missed it**, below) |
| Registry document.move ignores source status/ownership/palette; folder.move enters palette | 1/3/1/1 |
| Tree removes Move-action guard/filter guard/retain-last-key during request, accepts other modifiers, removes focus restore, reverses direction | 1/1/1/1/1/5 jsdom |
| E2E destination not expanded, reorder while filtering, pending-request keys dropped | 1 each |

### Issues caught while writing (my mistakes, fixed)

1. **Initial randomized real-service test ineffective.** Linear-congruential `%4`/`%2` low bits alternate, so four documents follow few fixed steps. Mutating `reorderStep` to screen index (wrong side of hidden nodes) still passes. Changed to mulberry32, 40→60 steps, asserting ≥30 actual moves rather than boundaries; mutation finally red. **Only mutation verification caught it**; otherwise apparent proof hidden archived nodes preserve order actually proved nothing.
2. **Hidden-radio E2E clicks ineffective.** `check({ force: true })` on sr-only input targets dialog top-left (label lacked relative positioning), hitting elsewhere; ten of twelve happened to pass. Added label `relative`, tests click label text like users.
3. **Original aria-live `role="status"` caused existing strict-mode violations.** Searched `getByRole("status")` (`row-actions.spec.ts:142` globally queries status on tree pages), switched to roleless `aria-live="polite"`. Found before running, not by tests.
4. **Keys during request initially dropped.** Quick Down then Up loses second, leaving row below despite intent to return. Retain last key and compute against new tree after response. E2E dispatches both keydowns in same tick; otherwise second may arrive after first completes and mutation still passes.
5. **`&&` chain did not stop on ESLint failure**, committing unused test `_prefetch` lint error; folded correction into unpushed commit. Same mistake as A-1, repeated.
6. **jsdom lacks `CSS.escape`** used for focus selectors; instead walk `[data-node-id]` comparing dataset, avoiding ID escaping/API dependency.
7. **Initial E2E mutation not lint-clean** (unused variable after removal), so next-build lint failed first and output appeared empty. Changed to `void x`.

### One feature whose necessity was not proved

**Focus restoration unnecessary in Chromium.** Removed it and probed: moved node receives two `focusout` events, but final `document.activeElement` remains that row—Chromium restores/preserves focus itself. Full E2E still passes, **cannot distinguish its presence**. Retained for browsers that may not preserve focused moved nodes; jsdom simulates blur-before-rerender and mutation fails. Protection untested in Firefox/Safari.

### Mixed folder-sync scenarios (`tests/integration/sync-and-organize.test.ts`, 6 cases)

Question: can Hub organizing A-1/A-2 break folder sync? Source shows sync writes require SOURCE_MANAGED, Hub HUB_MANAGED, and source ownership immutable. Tests prove externally with real services/DB, both directions:

- After two Hub-organizing rounds (create folders/documents, move inside folder, root-first, rename, nest folder, archive/restore document, archive folder), synced-source `knowledge_sources`, tree, documents, revisions, link index, `source_entries`, `sync_runs` **each row/field identical**, including timestamps/`updated_by`.
- After two changed sync applies (edit/delete/add/move/file returns), Hub Notes remains identical row-by-row.
- Hub rename/move/reorder/archive/restore/create folder/document within sync nodes, or moving Hub node into sync folder, all refused; both sides unchanged, later sync still applies.
- Identical sync v1→v2→v3 with/without interleaved Hub yields identical reader-facing source (tree/entries/revision counts/versions).
- Only indirect read impact: synced document `[[Hub note]]` becomes unresolved during Hub-note archive, resolves after restore; no synced-source writes.

**Mutation verification.**

| Broken behavior | Result |
| --- | --- |
| Disable ownership guard (`requireOwnedSource`) | Refusal case red |
| Read whole-workspace tree instead of source tree (cross-source contamination) | Three row-unchanged/interleaved-Hub cases red (**initially only two**, below) |
| `assertActiveFolderAncestry` ignores parent source; `moveTreeNode` allows `CrossSourceMoveError` | **No red**, because DB `fk_tree_parent_same_source (source_id, parent_id)` independently blocks it (still 409/no writes). Equivalent mutation, not gap: code/DB both guard; only outcome proved |

**Two ineffective initial tests, both caught by mutation verification:**

1. “Hub organizing leaves sync source unchanged” initially survives contamination: move node root-first then root-last, cross-source renumbering shifts sync positions then restores, so final comparison sees unchanged. Now leave node first.
2. Separate “each source siblings start at 0” still passes mutation, proves nothing, deleted.

Root equal-position order within workspace uses ID (time-ordered uuidv7), so `world()` creates two Hub root nodes before sync; reversing (older sync nodes) hides contamination.

**Unproved areas.**

- **One full integration failed `knowledge-link-service.test.ts`'s `says how much of the index can be trusted` (106 seconds)**, followed by two complete 580/580 passes. Own workspace, no global-state dependence; cause unknown, possibly freshly restarted MariaDB, speculation only.
- Sync uses import service `create`/`upload`/`finalize`/`apply` with memory bytes, not browser folder selection/upload.
- **Simultaneous Hub organizing at sync Apply moment untested.** Both lock source `FOR UPDATE` before workspace, preventing interleaving according to source reading, not measured.
- Only FOLDER_SYNC source type tested.

### Measurements

Next build output (±1 kB grouping error, slice 0; each test:e2e builds twice, differing 1 kB):

| Page | After A-1 | A-2 |
| --- | --- | --- |
| Document First Load JS | 194 kB | **194–195 kB** |
| `/edit`、`/new` | 170、171 kB | 171–172 kB |
| Graph/share | 119, 114 kB | 119–120, 114–115 kB |

Within error. `MoveDialogHost` enters knowledge layout, charging all knowledge pages; composition uninvestigated.

### Spec deviations (written back into §7.6/plan)

- Labels Move document…/Move folder…, rather than “Move to…”.
- Palette Archive document already added by A-1; A-2 adds only Move.
- Reorder has no Undo toast; aria-live reports position.
- Dialog has no search input.
- **No macOS/Windows Alt+↑/↓ tests** (plan A2.4).

### Unproved areas

- **No visual inspection.** Light/dark dialog indentation, Current, selection/focus/scroll only E2E attribute assertions. `has-[:checked]`/`has-[:focus-visible]` compiled CSS inferred indirectly from selectable/clickable behavior, stylesheet unread.
- **macOS/Windows Alt+↑/↓:** above.
- **Firefox/Safari:** Chromium only, focus protection unverified there.
- **No screen-reader run**; aria-live content/remounting for repeated announcement follows spec without listening.
- **Very large trees:** max-h-72 dialog scrolling, hundreds of folders unseen; each reorder walks `[data-node-id]`.
- **Contiguous-position assumption** rests on renumbering Hub siblings after every create/move and randomized test; future paths (e.g. import into Hub) leaving gaps bias `reorderStep`, possibly one-row discrepancy. Server clamps excessive indexes, preventing corruption but not imprecision.
- **Two-tab races:** E2E destination archived while dialog open; simultaneous sibling reorder untested, relies on service locks; retain-last-key handles one tab only.
- **Reorder failure presentation:** jsdom tests no position announcement/focus restoration; browser failure-toast behavior lacks E2E.

## Slice D — `[[` autocomplete and creating from broken links

Branch `claude/wikilink-autocomplete-slice-d`, three commits: suggestion data/order (`1689ba7`), rendered-editor list (`7c72ad3`), create from broken link (`36688e5`). Design/deviations in spec §6.3.

### Results

| Layer | Added | Result |
| --- | --- | --- |
| Unit | 98 cases (`link-suggestions` 21, `wikilink-suggest` 49, `create-from-link` 14, `document-links-panel-create` 3, plus cases in `markdown-renderer-links`, `phase5-authoring-input`, `document-draft`, `graph-model`) | Full 90 files **1377/1377** |
| integration | `listLinkTargets` 6, `link-targets-api` 8, `new-document-from-link` 4 | Full 51 files **599/599** |
| e2e | `zz-composer-autocomplete` 9, `zz-create-from-link` 5 (read-only/editor identities); 3 existing assertions changed (below) | Full **195/195** (6.8 minutes), no flaky/skips |
| `tsc`, `eslint`, `next build` | — | Clean; both builds per test:e2e pass |

**Full counts at merge** (after #86/#87 incorporation, final run before #88 merge): unit 1409, integration 603, e2e 199. Above table is branch before incorporation.

**Proof without `showMarkdown`.** Autocomplete jsdom/E2E type in rendered editor, then extractor inspects links in **saved Markdown** (`savedLinks`), with exact equality after `replaceMarkdown` round trip—CLAUDE.md invariant (editor preserves wikilinks) holds on this new write path.

### Mutation verification

Each changes one location, runs corresponding tests, checks red; survivors handled individually:

- **`listLinkTargets`/route/repository (12)**: 1 survivor—remove `d.status = 'ACTIVE'`. Archive case archived both document/tree, unable to distinguish conditions; added document-only archive case kills it.
- **`rankSuggestions`/trigger detection/`isWritableAsWikiLink` (19)**: 2 equivalent survivors—empty-query grouping (one layer only), redundant no-fragment/alias checks already covered by another condition.
- **Plugin/list DOM (~40)**: initially 11 survivors. `keyCode 229`/`isComposing` tested successively, first key invalidates second (split cases); same-position-after-Esc fails to detect uncleared `dismissed` due to mapped position moving (test leave/return cursor reopens); no Shift+Enter case; jsdom ⌘Enter uses metaKey but ProseMirror Mod there is Ctrl (use Ctrl to detect loss of composer handler); three listener removals unchecked (count matching add/remove); selection test starts before `[[`, so removing selection guard still passes (select final character). Cursor-move-after-selection and row mousedown preventDefault (list already prevents) redundant—mapping positions cursor after new node—deleted. **Two final survivors have no observable difference**: read-only key guard duplicates sync; unmount leaves listeners collection (memory only, no behavior).
- **Create from broken link (29)**: 4 survivors. Three killed by new tests: `link.kind !== "WIKI"` and graph PATH check (tested slash paths only, while gone.md alone is valid title); untested `renderedLinksFrom` bypassed by handwritten RenderedLinks reader fixtures. One equivalent survivor: `titleForNewDocument` 512-character cap redundant with extractor refusing targets longer than 512 characters, explicitly states intent.

**Sidebar “4 plus Show all” (next section):**

- **9 E2E mutants: 7 killed, 2 surviving real gaps, not equivalents:** Show all at exactly 4 (`>` → `>=`) and number reports hidden count rather than total. My Space favorites accumulate by account since #86, preventing exact-four fixture; number checked by regex. Seed Team lacks 5 documents, while adding shared-DB documents affects other specs.
- **Fix: pure `favoritesInPlace`**, unit boundaries 0/3/4/5/10, total count, order, input unchanged. **6/6 helper mutants killed** (4→5/3, >=, hidden count, oldest four, mutate input), including earlier survivors. E2E retains integration checks.

### Sidebar favorites: two versions, initial claim unsupported

**First version** lists all favorites with max-h-72 (18 rem) internal scroll; PR/spec claim it does not push tree offscreen. **Unmeasured claim proved wrong**: at 1280px width with ≥10 favorites, tree starts 366px below sidebar top; 720px window (604px sidebar) leaves ~238px tree without scroll, 600px leaves ~118px. Nested internal/external scrolling means wheel over list cannot scroll outer container. Measured only after user asked whether >4 favorites crowds other items.

**Second/current version:** latest 4, Show all N when >4, opening existing ui/menu listing all with real `<a role="menuitem" href>` links. User-proposed approach; Menu works as links (tested render={<Link/>}, E2E href assertions, without reverting to inline expansion).

- **Measured at 720px height/≥10 favorites: fixed 206px**, independent of count (still 206px at 20/30); first version 288px list plus heading.
- **Visual inspection:** light/dark (dark uses data-theme=dark, not emulateMedia—initial dark screenshot via emulateMedia was light, corrected), 720px, four rows/Show all 20, right-side panel, current-document highlight, source names right. Initial w-72 truncated long titles excessively; changed to w-96, constrained to viewport.
- **Cost:** fifth/later items require another click; panel lacks star buttons, removal via first four/tree/document page; no panel search.

### Issues caught by tests/inspection (my mistakes, fixed)

- **`row-actions.spec.ts:75` failed from B.0 race; initial diagnosis half-right, initial fix insufficient.** Open palette, confirm first row selected, Down expects second; standalone/29-case batch pass, full suite fails twice (earlier full/CI passes were luck).
  - **Initial half-correct diagnosis:** recent response arrives after Down; code preserves selected row while it shifts downward, so second no longer selected. Real trace request ~17ms, tiny window. **Fix:** listbox aria-busy true while pending, **on opening render itself**, not effect; shared openPalette waits; new E2E page.route delays 1.5s, asserts busy and selection identity preserved. **Same full-suite case still fails afterward.**
  - **Real cause (failure snapshot: second row Open graph, so list changed again after Down):** reading document registered by topbar effect (`reading`), initially undefined; recents includes current document, then removes it when reading registers, shifting selection to first. aria-busy cannot prevent because IDs already changed/request settled. **Fix:** URL has document ID on first render; synchronous `documentIdInPath(pathname)` excludes it alongside reading from beginning. (Cannot use isUuid: uuidv7.ts imports node:crypto, breaking client bundle; local format matching only excludes a list item, never authorizes.)
  - Initial E2E assumes two recent rows (standalone only); prior specs create documents and goto root lands on older document. Now compare selected-row text identity.

- **Short-window list covers cursor line** (E2E). Initially only chose above/below; too-tall list overlaps line. Now scrolls internally with max-height from remaining space when neither side fits.
- **E2E getByRole(textbox) misses editor while list open** because role becomes combobox. Design consequence; tests use aria-label.
- **Fast typing groups selection with previous input in Undo** (jsdom); closeHistory makes selection separate step.
- **Enter without results handled by editor keymap** splitting paragraph, so not swallowing cannot use defaultPrevented; inspect document instead.
- **Two lint/type errors:** nonnull `!` after optional `?.`; guessed test index fields do not match LinkIndexState.
- **Three existing E2E expectations change:** two reading-links cases (writable broken links now point to form), workspace-graph ghost node (writable is link). **Old assertion “broken link is not link” in rename case unexpectedly passed first full run**, failing second identical-code run. Cause unknown: server should already create link. Possibly getWorkspaceShellModel temporarily null, unknown canWrite suppresses creation as graceful degradation, speculation. New assertion (form link, not renamed document) passes each subsequent run.
- **Graph broken-node hover intercepted by svg:** `<a>` bounds include pointer-transparent label, center outside circle; target node circle (existing workspace-graph reminder).

### Measurements (D.9)

`scripts/diagnostics/measure-link-targets.ts`: disposable-DB workspace with N Hub documents (mixed English/Chinese titles, average ~35 characters), measuring listLinkTargets (GET …/link-targets behavior), payload, per-key rankSuggestions.

| | 2,000 documents | 5,000 documents |
| --- | --- | --- |
| listLinkTargets first | 24.5 ms | 39.5 ms |
| listLinkTargets warm, 30 runs | p50 15.9, p95 27.1 ms | p50 42.5, p95 53.2 ms |
| payload (raw/gzip) | 405.6/52.6 KiB | 1,015.6/132.2 KiB |
| Frontend JSON.parse | 1.4 ms | 3.3 ms |
| rankSuggestions per key (warm) | p50 0.2–0.5, p95 ≤1.0 ms | p50 0.9–1.8, p95 ≤2.3 ms |
| rankSuggestions first (compute each matching key) | 4–24 ms | 13–27 ms |

Query plan identical at both sizes: idx_sources_workspace_status → uq_documents_source_id per document, then PRIMARY/uq_tree_one_document; Using temporary/Using filesort for revision-time ordering; whole query slightly over 40ms at 5,000.

**No unexpected results**, so **server-query fallback above cap not brought forward**. Key costs milliseconds; initial [[ waits for 40–50ms query plus transfer. Cap 5,000 produces 1MB raw JSON (132KiB gzip), itself justification for a cap.

### Unproved areas

- **Real Chinese IME:** isComposing/keyCode229 only synthetic jsdom events; Playwright cannot drive IME, so Enter mid-Zhuyin/Cangjie composition preventing selection unverified. Most likely real-user case, listed first.
- **No screen-reader run.** Dynamic combobox/aria-activedescendant on contenteditable plus polite live region follow ARIA pattern, E 2 E attributes asserted, unheard.
- **Chromium only**, no Firefox/Safari; coordsAtPos/fixed positioning expected alike but unverified.
- **Visual inspection only one-row light/dark screenshots.** Multiple rows/long-title truncation/above-cursor presentation only position/color assertions, unseen.
- **Following scroll-container cursor** (page/editor scroll) has scroll/resize listeners but no E2E.
- **Same machine/process measurements:** exclude HTTP/proxy/compression, local DB/synthetic titles. Service-seeding 5,000 documents took 237s; gzip computed with zlib rather than measured online bytes.
- **sameTitle data unused by UI:** identical-title documents distinguished only by Source.
- **Members see all workspace titles**, graph-equivalent membership authorization specified; read-only members also access list since documents readable. Finer future read scope requires link-targets update.
- **Two tabs, document archived while list open:** list stale up to 60s; choosing newly archived document writes broken link (ACTIVE-only resolution). Untested/unhandled, same consequence as normal archival.

## Slice B.0 — ⌘K recents, sidebar latest 4 favorites plus Show all

Branch claude/b0-recents-favorites (incorporated into main after #89). Design/deviations in spec §8.1.

### Results

| Layer | Added | Result |
| --- | --- | --- |
| Unit | parseDocumentIdList (phase5-authoring-input), recentDocumentIds/favoritesInPlace (document-shortcuts) | Full 95 files **1436/1436** (includes 5 documentIdInPath cases: document/child pages, nondocument, invalid-ID segment, full-segment-or-none/case, unrelated IDs; 5/5 helper mutants killed, two former survivors killed by additions) |
| integration | recent-documents-api 10: order/shape, no-store, no body, current title, skip archived/missing/malformed/other workspace, read-only permitted, nonmember/missing same 404, bad ID400, cap8, empty list | Full 53 files **613/613** |
| e 2 e | zz-recents-favorites 9: recent order/current exclusion, Enter previous, archive disappearance, typed-query hides/clearing restores, unsolicited document hidden, failure fallback, no-recents navigation first, **late response busy/selection preserved**; sidebar latest 4/in-place/≤240 px, Show all real links, Escape restores focus, persists reload, no Show all at 2 (Team local favorites) | File 9/9; prior all-visible 7 cases at 4 workers ×12 rounds 84/84 |
| tsc/eslint/next build | — | Clean |

### Mutation verification

**Server (recent-documents.ts/routes/parseDocumentIdList/recentDocumentIds,12):12/12 killed.** Includes no other-workspace/member checks, errors not swallowed, order changes, invalid workspace IDs, ignored ids, no UUID/dedup/cap/current exclusion/duplicate removal.

**Palette (11 valid E2E mutants):7 killed,4 equivalent survivors:**

- Killed: recents after actions (render/index disagreement), current included, missing ids request, incorrect first activeIndex shift, unsolicited response shown, typed query retains recents (**both guards removed**), missing Recent heading.
- Equivalent survivors: duplicate typed-query guards (recentRows/fetch effect) individually removable without observable change; deliberate defense, both removed killed. Failure setRecents([]) redundant with latest-ID intersection; !response.ok redundant because missing hits throws on map and catch handles identically.
- **One script misclassification:** missing-Recent mutant not lint-clean (unused position), build fails; script calls no-output survivor. Changed to position===-1, killed. Script now labels no-output invalid, not surviving.

### Issues caught by tests/inspection (my mistakes, fixed)

- **E2E read() did not do what comment claimed.** Waits only tree row then opens next; sidebar effect records recents later, so next goto can outrun it. Second full run fails missing Beta; one case at6 workers ×30 rounds fails twice; diagnostics at8 workers ×60 rounds show one missing final recent. Fix polls localStorage until document truly first in recent.
- **Small product defect from same failed traces:** request sequence [b,a,X] excluding current → [c,b,a,X] including current → [b,a,X]. During unknown reading, intermediate response arrives before newer request, showing **already excluded document**; at load request3.2s leaves it visible seconds. Display intersects current desired IDs, preventing stale responses reintroducing excluded entries. New routed E2E returns three documents, asserts excluded absent.
- **Favorite count assumed no other account stars**, now account/server-synced (#86). Sequential workers1 fine; concurrent rounds mix stars (Expected1/Received35). Count only test-stamped links.
- **Saturated-server assertion timeouts:** server-bound assertions lack ROUND_TRIP 15 s;8 workers ×20 rounds (100 parallel tests) ~30% timeout, mostly Test timeout 30000 ms/create/goto, saturation rather than logic. After ROUND_TRIP,4 workers ×12 rounds 84/84. **8×20 never rerun to passing**; not acceptance criterion, records stress limit.

### Complete E2E record (honest version)

After #89, complete sequential npm run test:e2e ran four times, **none clean all-green**:

1. 208 passed/1 red/2 skipped: zz-organize come back from Show archived (row remains 15 s after context archive). Isolated file 9/9, case 12 rounds 12/12; **not reproduced, no trace retained** (later reruns cleared).
2. 208 passed/1 red/2 skipped: my recent case (read race), **fixed**. zz-organize all passes.
3. 209 passed/2 red/2 skipped: two other zz-organize cases (say how many links stop working: no toast; nonempty folder: Base UI inert overlay intercepts click, element outside viewport).

4. After 4+Show all:213 passed/4 red/2 skipped, **all zz-organize***: move Alt+↑/↓ explains filtered no-op (depth mismatch), organize come back from Show archived (run 1), link-count toast (run 3), nonempty folder (run 3 outside viewport). Three repeated; four distinct zz-organize failures across four full runs, none every time.

**(Contemporaneous hypothesis, superseded by later investigation below)** Run4 traces, two cases: archive POST200 confirms server mutation, UI fails follow-up (row remains15s/no inbound-link toast). Frontend refresh/processing absent after success, not server failure. Same area as #87 background refresh discarding transition (#63/#64), **same cause unproved**, uninvestigated then. Real user archive-success/stale-row issue merits investigation beyond flaky E2E.

All four runs' failures in zz-organize context/menu flows, **code unchanged by B.0** (palette fetching/sidebar favorites only). Failure screenshots show no favorites, excluding sidebar-height shift. **Baseline:** clean origin/main dff2043 without B.0, one full run203 passed/1 red/2 skipped: organize in-folder archive/Undo locator.click outside viewport, same as run3's second symptom. **These intermittent organize-menu failures occur on main without B.0**; one sample, not rate, cause then unknown.

**CI evidence after PR#94:** first PR E 2 E fails move:136 (Move folder… absent 30 s after context click;215 passed/1 red). **Main push CI same case fails** after#90 (move:109/:136,207 passed/2 red); after#89 row-actions:133 Copy link failed; unit/build/integration green both. Thus menu-flow intermittency also on main/CI without B.0. Authorized person needed for CI rerun (integration account 403).

**Final full E 2 E after documentIdInPath, with openKnowledge one-line fix below in working tree:217 passed/1 red/2 skipped.** archived-source-active-doc:56 immediate Document display options click after goto fails to open; second suite test on cold server. Isolated 10/10, same pre-hydration click type, unchanged. row-actions:75/organize all pass.

**Later investigation: data-volume dependent rather than random.** API-seed200 My Space documents before organize (prior full-suite specs likewise add many): **8 of22 fail**, same intermittent cases (move109/136, organize164/198/223/245); isolated short-tree21/21. Instrumenting scrollTop setter/focus stack traces reveals:

1.Immediately after goto, test hovers folder (scrolls200+ rows bottom), clicks ⋯ **before hydration completes**.
2.After hydration KnowledgeTree **first mounts**, initial reveal-selected effect **scrolls tree to top** (nav.scrollTop6364→36). React replays pre-hydration click; menu opens with trigger y6942, offscreen menu (element outside viewport).
3.Initial hypothesis effect reruns on refreshed roots; once-per-selection guard **does not improve**, because new mounted instance has empty ref. Restored. App refresh not randomly scrolling; test fails to wait for hydration.

**One-line fix:** organize.ts openKnowledge goto waitUntil:networkidle, matching existing knowledge-explorer convention (“Wait for hydration”). **Results:** long-tree 8/22 red → three complete long-tree reruns 1/1/0 red (remaining move 71 below); two full runs, one 217 passed/0 red (first all-green on branch), other sole B.0 row-actions 75 failure (organize all pass). Tiny sample, not rate.

**Unresolved:** long-tree move:71 Current/disabled destination unexpectedly enabled, still ~3/5 red after fix. Trace has no move request, document unchanged; collections-derived current location differs from DOM folder. **Cause unknown**, absent CI/full suite, only200-document stress.

**Main already has fix:** during investigation #93 merged same networkidle openKnowledge with same hydration/reveal/long-tree wrong-row diagnosis, additionally waits current row visible. Proposed patch superseded, not included in PR, no conflict after merging main. Above counts reflect my one-line fix, not#93.

### Unproved areas

- **Organize intermittency cause/rate:** **main cause found** (pre-hydration clicks exposed by long trees); one-line fixture fix **not yet included in this PR**; move71 unexplained in stress. Branch had no clean all-green full run at this recorded point; other files across three runs no other failures after subtracting my fixed/repeatedly verified case.
- **Show all lacks search/stars:**100 favorites creates long scroll panel (max 24 rem/60 vh), unmeasured/undesigned; sidebar no sorting/grouping.
- **Recents local only:** absent in other browsers (specD12 unchanged).
- **One request per palette open:** local overloaded response up to 3.2 s at 8 parallel browsers; single-user unmeasured.
- **Partial visual inspection only:** Show all light/dark at720px; **not inspected** palette Recent/two-line rows (text/order assertions only), Team sidebar, narrow drawer panel positioning, other cases besides long titles; Chromium only.
