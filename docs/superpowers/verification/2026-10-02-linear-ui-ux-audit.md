Method: dual-agent (A: /root/design_review · B: /root/detector_evidence)

# Linear UI/UX alignment — repository audit

| Item | Details |
| --- | --- |
| Report date | 2026-10-02, Asia/Taipei |
| Version inspected | `4bbab24` |
| Actual inspection date | 2026-10-01; organized the following day |
| Scope | Repo UI/UX inventory, source checks, browser verification, and official Linear design references |
| Original request | Scan the complete repo to identify UI/UX areas that can align with Linear |
| Status | Audit only; defects and improvements below have not been implemented |
| Findings | 16: 1 P0, 2 P1, 12 P2, 1 P3 |

Implementation follow-up is in the [remediation and verification record](2026-10-02-linear-remediation-verification.md). Status below describes the audit and rebase versions at those times.

This document is an audit snapshot for this version; it does not replace the living contract in `docs/superpowers/specs/frontend-design-language.md` or automatically promote recommendations to approved product requirements.

## Recheck after rebasing latest main

The original inventory base was `4bbab24`. After fetching `origin/main` on 2026-10-02, this Codex worktree was at detached HEAD; `git rebase origin/main` moved the checkout to `1cf8114` (no independent feature commits to replay). Report and critique snapshot were temporarily saved and successfully restored. Latest main is 4 commits ahead of the original base; audit files remain uncommitted, with no local application-source changes.

Reread latest source for each of the original 16 findings and compared #94/#95 changes: **1 resolved, 3 partially improved, 12 remain.** This is a source-level recheck without rerunning the full route/viewport matrix.

| Findings | Latest status | Evidence on latest base |
| --- | --- | --- |
| F01 | Remains | `body { overflow: hidden }` still applies globally; public share page has only `min-h-screen`, with no window scrolling or dedicated internal scroll container. |
| F02 | Remains | Primary navigation and 288px explorer remain two permanent rails; collapsing primary navigation reduces its width without integrating it with explorer. |
| F03 | Remains | Reader retains 224px outline rail while composer lacks it; Save/Cancel/Markdown controls remain in normal document flow. #92/#93 fix draft/loading/keyboard defects, without addressing geometry or long-document operations. |
| F04 | Partially improved | #95 changes Home document rows to `kh-interactive-row`, Lucide icons, Star buttons, and short dates, improving workbench consistency. Export and full export instructions still occupy Home; rows still lack shared action menus. |
| F05 | Remains | Import Source name input is still a manually written 38px field; folder-picker copy/control have not become a dedicated folder entry point. |
| F06 | Remains | Kbd still uses `text-kh-text-faint`; graph's “Scroll to zoom · drag to pan” remains faint. #95 adds Tooltip without replacing these low-contrast hints. |
| F07 | Partially improved | #94 adds recent documents for empty queries before actions; without recent documents, the duplicate Go to Knowledge may still be the palette's first action. |
| F08 | Remains | Sources rows are Links supporting native Tab, without `navigateListRows` arrow/Home/End behavior. |
| F09 | Partially improved | #95 adds Status and readable source-sync-state labels; import diagnostics still show codes, Audit settings raw event/target types, and composer mixes Chinese/English. |
| F10 | Remains | `useDesktopLayout()` still starts `true`, reading `matchMedia` only after mount; mobile first render may briefly show explorer. This transient layout risk was not retimed here. |
| F11 | Remains / needs measurement | Home still reads full source trees/current revisions through existing queries; imports may still include many entries and expand entire change groups. No production-size benchmark here, so this remains a measurement item. |
| F12 | Remains | Revision comparison still presents two complete Markdown texts side by side, without changed-line diff. |
| F13 | Resolved | #94 Favorites rail provides `Show all {n}` opening the complete favorites list. |
| F14 | Remains | Share page outputs an H1 in its header then renders raw Markdown, duplicating an identical opening H1. |
| F15 | Remains | Latest Tailwind still permits Arbitrary Values; #95 adds no enforcement blocking arbitrary sizing/type/radius utilities. |
| F16 | Still a low-priority style option | Neutral ramp and living contract's cool-blue direction remain; no palette-change implementation. |

Latest main's first priority remains F01's share-page scroll blocker, followed by F02/F03 shell and reading/editing experience. #94/#95 have affected F04/F07/F09/F13, so follow-up should address only remaining portions above rather than redo merged work.

## Conclusions and design judgment

Knowledge Hub already has a mature foundation in Linear's direction. The next most valuable work is unifying navigation structure, page-action placement, and list interactions for continuous reading, editing, searching, and organizing. Further individual font-size/radius adjustments offer less benefit.

The design has product identity: document tree, source management, wikilinks, backlinks, TOC, and graph form a knowledge workbench rather than a generic dashboard. The main issue is that new features have not fully returned to one interface: Personal Home, import forms, Sources detail, and revision comparison have differing lists, headers, or information hierarchy.

Linear's 2026-03-12 update emphasizes consistent headers/navigation/view controls across workflows, lowering navigation's visual weight to focus work content. This is the reference direction; the Linear app was not accessed for pixel-level measurements, and marketing-site CSS was not treated as exact product-UI specifications. [Linear UI refresh](https://linear.app/changelog/2026-03-12-ui-refresh), [A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh)

## Inspection scope and evidence limitations

- Inventoried 117 TSX/CSS files in `src/app`/`src/components`, checking related hooks, action registry, UI primitives, Tailwind/CSS tokens, routes, read models, existing specs, and E2E coverage.
- Covers shell/workspace selector, Personal Home, document tree, reader/editor, TOC/inspector/history, search/command palette, graph/list, Sources/detail, import/preview, Settings/general/members/groups/audit, sharing, and error/empty states.
- A and B used independent new browser tabs. A completed design assessment before seeing detector output; B's results entered synthesis afterward.
- Browser inspection included desktop 1850 × 873 and 1280 × 720, and mobile 390 × 844; representative desktop/mobile pages were checked in light/dark, without a full route × size × theme matrix.
- Used a separate isolated E2E database in the existing MariaDB service and temporary dev server at `127.0.0.1:3201`. Team mode temporarily enabled for admin inspection; production default remains Team coming soon. Test documents/share links existed only in isolated DB.
- Temporary server stopped, isolated DB removed, browser viewport/theme restored. Next dev's automatically rewritten `next-env.d.ts` restored.
- No complete screen-reader session, all failure branches, import Apply, 20,000-row benchmark, or production-latency benchmark. Large-data/performance items are source-backed risks/measurement recommendations, rather than reproduced performance failures.
- No application-source edits, commits, or PR creation. Deliverables are audit document and critique snapshot.

## Existing strengths

1. **Shared visual language.** Semantic light/dark tokens, Inter, 1.5px Lucide strokes, 24/32/40px control ladder, shared focus/menu/tab, restrained surfaces/separators already exist. Sources: `src/app/globals.css`, `tailwind.config.ts`, `src/components/ui/control.ts`, `src/components/ui/field.ts`.
2. **Core operation mechanisms exist.** Action registry shared by palette/row menus/other entry points, shortcuts, context menus, toast/undo, search arrow navigation, scroll restoration, persistent drafts, and account favorites. The 9/20 report cannot be reused to call these missing.
3. **Structured knowledge reading.** Reader TOC, backlinks, details/history inspector, wikilink resolution, and graph list alternative serve product purposes; preserve SOURCE_MANAGED read-only policy, revision conflict, import blocker/stale guard, and share-link boundaries.

## Top five priorities

### F01 — P0: public long shared articles cannot scroll normally

**Evidence: reproduced in browser.** `src/app/globals.css:119`'s body rule sets `overflow: hidden` at `:127`. `src/app/s/[token]/page.tsx:30`'s `main` has only `min-h-screen`, no fixed viewport height/internal scroll container, and no AppShell wrapper.

A 30-section test article at 1280 × 720 has body height 3774px and last-heading bottom 3670px. After scrolling down three pages, `window.scrollY` and `document.scrollingElement.scrollTop` remain 0, leaving later content offscreen.

**Impact:** long-document sharing/reading is blocked. P0 identifies a local blocker for this flow, rather than making the whole app unusable.

**Recommendation:** scope viewport scroll lock to AppShell, allowing normal document scrolling on public reader; alternatively give sharing a clear viewport-height scroll container. Preserve AppShell's internal-pane scrolling.

**Acceptance:** desktop wheel, keyboard, and mobile touch reach the final paragraph; ordinary reader/tree/inspector scrolling remains intact.

**Suitable workflow:** `/impeccable harden`.

### F02 — P1: double sidebars and cross-page headers lack consistent spatial roles

**Evidence: source + desktop visual.** Primary nav in `src/components/shell/app-shell.tsx:88` is `w-40` (160px), explorer in `src/components/knowledge/source-sidebar.tsx:141` is `lg:w-72` (288px). Expanded total 448px, approximately 35% of a 1280px viewport. Topbar reserves corresponding columns: `src/components/shell/topbar.tsx:30`, `:47`.

Shared `PageHeader` has a compact location/title/action row, while Sources detail manually uses a large-title header in `src/components/sources/source-detail.tsx:24`; contextual document actions stay in content headers, with only title/Details partly moving into Topbar after scrolling out of view.

**Impact:** left-side structure consumes considerable reading space, and cross-page transitions require relearning header/navigation/action positions.

**Recommendation:** combine workspace, primary navigation, favorites/recents, and document tree into one left navigation area, retaining source grouping and necessary collapse. Define shared location and view/action bars with stable Search/Create/Share/Details positions. An incremental version should at least coordinate collapse strategies of sparse primary navigation and explorer.

The repo's living contract §18 already recognizes this unfinished item. A single sidebar is a proposal for this product, not a claim that every Linear page has only one pane.

**Acceptance:** usable reader content width at 1280px; predictable navigation/action placement across reader/search/Home/Sources; mobile keeps drawers instead of shrinking desktop rails.

**Suitable workflow:** `/impeccable layout`; write a spec before shell changes.

### F03 — P1: inconsistent reading/editing geometry and long-document actions leaving viewport

**Evidence: source + browser.** Reader uses `src/components/knowledge/document-pane.tsx:29`'s 224px outline rail, while composer directly centers the reading column at `src/components/knowledge/document-composer.tsx:501`, `:536`. At 1850px width, A observed the content start moving approximately 118px right from reader → editor.

Composer's Save/Cancel/Markdown controls are in normal document flow without a sticky action bar. After scrolling a long document three pages, internal scroller `scrollTop` is 2160px and Save button top is -2092px.

**Impact:** entering edit interrupts visual position, and long-document/mobile users must return to the top to act. Draft autosave and formally creating a revision have different semantics, so their status should share one visible location.

**Recommendation:** Reader/composer share pane geometry; place save status, Save, Cancel, and Markdown mode in a fixed contextual action bar. Clearly distinguish “draft synchronized” from “formal revision saved,” preserving revision/conflict/draft contracts.

**Acceptance:** wide-screen reading/editing transitions retain content start; Save accessible anywhere in long documents; `⌘Enter`, Esc, Markdown toggle, and draft restoration retain existing behavior.

**Suitable workflow:** `/impeccable layout`, `/impeccable clarify`.

### F04 — P2: Personal Home lists and action hierarchy not integrated into workbench

**Evidence: source + desktop/mobile visual.** Rows in `src/components/knowledge/personal-home.tsx:15` use blue links, permanent underlines, and text `★/☆`; other rows primarily use `kh-interactive-row` and Lucide Star. Home lacks shared row-action menus/hover treatment. `:23`, `:24` permanently show Organize, Export ZIP, and full export-scope instructions above the fold.

At 390px mobile, full timestamps/favorite controls consume row space, truncating longer titles. Empty Drafts/Favorites sections retain explanatory paragraphs, accumulating first-screen height.

**Impact:** daily entry looks like an export/document-link list; frequent “continue writing/reading” and infrequent ZIP export have similar visual weight.

**Recommendation:** shared DocumentRow (icon/title/metadata/row actions), relative time or mobile second-line metadata; prioritize “continue writing/recently read/favorites,” move Export into overflow, and show export-scope instructions when opened. New note remains the sole primary CTA.

**Acceptance:** favorites/menu/focus/hover consistent between Home and search/tree; meaningful title length on mobile; daily tasks precede infrequent management work.

**Suitable workflow:** `/impeccable distill`, `/impeccable polish`.

### F05 — P2: import form bypasses shared control primitives

**Evidence: source + browser style measurement.** `src/components/imports/folder-import-form.tsx:252`, `:254` manually implement Source name input; measured height 38px and border `#e5e7ee`, outside the 24/32/40px ladder. Shared Input uses `border-strong` at `src/components/ui/field.ts:12`. Manual border contrast against white is 1.236:1.

Folder input at `:268` displays native “Choose File / No file chosen” in the inspected browser, mismatching whole-folder selection. Actual `webkitdirectory` is added only by client ref.

**Impact:** form height, identifiable boundaries, and task copy differ from other app pages. This is a component-adoption gap, without needing another design system.

**Recommendation:** existing Input for Source name; accessible shared folder-picker trigger clearly showing Choose folder, selected folder name/file count, then Preview.

**Acceptance:** controls share the height ladder; operation label matches picker function; retain native file picker and keyboard accessibility.

**Suitable workflow:** `/impeccable polish`, `/impeccable clarify`.

## Complete remaining backlog

| ID / priority | Finding and source evidence | Recommendation and completion criteria |
| --- | --- | --- |
| F06 / P2 | `src/components/ui/kbd.tsx:9`, `src/components/knowledge/graph-canvas.tsx:382` use faint text. Light Kbd 3.509:1, graph hint 3.761:1; calculated dark-token ratios 3.876:1, 4.330:1. | Provide sufficient-contrast hint token; meaningful small operation text needs normal-text 4.5:1. Retain low visual weight without sacrificing readability for calmness. |
| F07 / P2 | `src/components/search/quick-search.tsx:99`, `:254` place action matches before results. Team reader empty query shows 17 options (6 navigation, 3 create/import, 8 document actions), initially selecting Go to Knowledge for the current page. | Empty query prioritizes recent/contextual actions and reduces duplicate navigation, speeding existing edit/share/move actions after reaching a document. Preserve groups/search/keyboard features; do not delete valid commands or claim no recent docs exist. |
| F08 / P2 | `src/components/sources/source-list.tsx:15`, `source-list-row.tsx:31` have native link Tab stops only, without Search/Home's arrow helper. | Unify ArrowUp/Down/Home/End and Enter across Sources/work lists, preserving native Tab and modified click. Convenience gap, not total lack of keyboard access. If row focus later becomes an action target, assess E/batch actions then; add no fake actions. |
| F09 / P2 | `folder-import-form.tsx:212`, `import-sticky-footer.tsx:133`, `import-warning-summary.tsx:28`, `import-change-group.tsx:70` directly show diagnostic codes; `workspaces/audit-settings.tsx:35` shows raw eventType/targetType; composer mixes Chinese/English from `:530`. | User-facing label/copy mapping; first layer says what happened/next step, preserving codes/IDs in Technical details. Define primary language/fallback first without assuming app-wide Chinese conversion. |
| F10 / P2 | Desktop state initially true in `src/components/knowledge/knowledge-layout.tsx:17`; first mobile render briefly shows `source-sidebar.tsx:141`'s w-full explorer, changing to Browse after hydration. Topbar/reader actions mostly measured 32px, backlinks 24px. | CSS predetermines narrow-screen visibility to keep explorer from obstructing initial content; coarse pointers need greater actual hit areas and mobile metadata/toolbar rearrangement. Transient reproduced in dev, production duration unmeasured; 32px does not automatically violate the 24px AA target minimum. |
| F11 / P2 | `src/app/w/[workspaceId]/home/page.tsx:13` reads all sources/trees then each current revision, while `personal-home.tsx:28` initially shows only 12 recent edits; `imports/import-preview.tsx:89` supports 20,000 manifest entries, and expanded `import-change-group.tsx:44` maps all changes at once. | Measure Home/preview at representative daily scale. First fetch needed data only and progressively disclose diagnostics, then use pagination/windowing as evidence warrants. Small seeds or Next dev compilation delays do not establish slow production, and parallel queries must not bypass authorization. |
| F12 / P2 | `src/components/knowledge/revision-restore.tsx:21`, `:22` show full Markdown side by side without changed-line highlighting. | Retain raw Markdown comparison while adding change summary/line diff, revision times, and affected content for informed restore; narrow screens use toggles/vertical arrangement. Restore still adds a revision with conflict checks rather than overwriting history. |
| F13 / P2 | `src/components/knowledge/source-sidebar.tsx:75`, `:76` truncate Favorites/Recent to 4 each without totals/Show all. Full favorites exist on Home, but rail does not explain remaining items. | Show all/expand when more exist, clarifying limits. Do not misreport existing account favorites as local-only. |
| F14 / P2 | `src/app/s/[token]/page.tsx:33` outputs title H1, then `:47` renders Markdown directly; an identical opening H1 visibly repeats twice on the share page. | Public reader shares app reader's title-ownership logic, avoiding duplicate titles when metadata/body opening heading match. Accept H1/no H1/frontmatter-title cases and preserve shared page's lack of Hub-scope link resolution. |
| F15 / P2 | Design contract §3 and `tailwind.config.ts` comments claim arbitrary off-scale type/radius do not compile; `tests/unit/design-tokens.test.ts` checks config shape only, and ESLint mainly blocks focus spelling. Existing Tailwind compile probe generates CSS for `text-[13px]`, `rounded-[10px]`, `p-[30px]`. `rounded-xl` is also a valid current token. | Correct enforcement description; add lint/static checks for unapproved arbitrary values/shared-primitive bypass, retaining necessary geometry exceptions. Replacing scales blocks unnamed ordinary utilities, not every arbitrary value. |
| F16 / P3 | `src/app/globals.css:15` retains cool/blue neutral ramp; living contract §7 records this tint as a deliberate difference. | To move toward Linear 2026's low-saturation warm grays, separately compare light/dark token drafts before deciding. Style choice, lower priority than navigation/interaction/contrast defects; Knowledge Hub's primary color need not disappear. |

F06's threshold follows [W3C Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Color calculations read CSS tokens/actual computed styles rather than antialiased screenshot pixels. Dark ratios are source-calculated; representative pages were visually inspected in dark mode without dark-browser measurements at every hint location.

F07/F08 reference Linear's existing contextual/keyboard workflows in [Search](https://linear.app/docs/search) and [Select issues](https://linear.app/docs/select-issues). F16's warm-gray direction follows [Linear design refresh](https://linear.app/now/behind-the-latest-design-refresh). This product need not copy Linear issue-status/assignee/board models.

## Heuristic design health

A's independent design judgment rather than automated-test scores. Each item 0–4, where 4 means highly complete; all ten apply to the Operate/Read surface.

| Nielsen heuristic | Score | Primary evidence |
| --- | --- | --- |
| Visibility of system status | 3 | Loading/toast/draft status exist; contextual Save/status not continuously visible in long documents |
| Match with user language | 2 | Import diagnostic codes, Source ownership/enums, partly mixed languages |
| User control and freedom | 3 | Draft/undo/restore exist; public long-document scrolling blocked, some actions require returning to top |
| Consistency and standards | 2 | Differences in double rails, Home rows, import fields, Sources header/keys |
| Error prevention | 3 | Revision conflict, capability/ownership, stale/blocker guards, share revocation have contracts |
| Recognition rather than recall | 3 | Menus/palette/tree/outline recognizable; contextual-action ranking and low-contrast hints can improve |
| Flexibility and efficiency | 3 | Shortcuts/search navigation/recents exist; some work lists inconsistent |
| Minimalism and visual hierarchy | 3 | Restrained tokens work; double rails, Home export copy, management hierarchy need consolidation |
| Error recognition and recovery | 2 | Draft/revision recovery preserves work; import codes/some messages remain technical |
| Help and guidance | 2 | Empty states/some hints explain; terminology/action hints/advanced-task explanation inconsistent |
| **Total** | **26/40** | **Usable foundation established, with worthwhile priority improvements in workflows/consistency** |

## Cognitive load and emotional journey

- **Home:** beyond primary New note, Organize/Export/full export-scope instructions precede work content. Three entry points are not excessive by count, but task frequency and first-screen visual weight mismatch.
- **Command palette:** 17 observed options, already grouped/searchable, so exceeding four does not automatically fail. Duplicate current-location navigation is first, requiring users to look lower for document actions.
- **Import preview:** Summary simultaneously shows multiple document/folder/asset categories, with diagnostics globally and per file. Put Apply blockers and concrete remedies first, expanding the rest progressively.
- **Reading → editing:** horizontal content-start shift and Save scrolling out of view create a low point of losing control position when entering writing. A fixed action/status row improves completion without decorative animation.
- **After sharing:** inability to scroll long articles directly damages sharing's final experience. Fix F01 before refining public-page typography/title.

## Persona red flags

| User | Main workflow and specific issues |
| --- | --- |
| Alex, heavy keyboard user | Reader → editor shifts content; Sources lacks Search's arrow path; palette prioritizes duplicate navigation. Preserve shortcuts, then unify row focus/context. |
| Sam, low-vision/accessibility-dependent user | Kbd/graph operation hints have insufficient contrast, manual import borders faint, public long articles cannot scroll normally. No complete VoiceOver run; DOM semantics do not establish full screen-reader acceptance. |
| Casey, mobile user | Full Home timestamps squeeze titles, Menu/Browse/Details have separate entry points, dense 32px actions need better touch areas; initial explorer briefly fills content before hydration. Preserve existing drawers/draft persistence. |

## Detector results and false positives

Executed only once:

```sh
node /Users/chuntsai/.codex/skills/impeccable/scripts/detect.mjs --json src/app src/components
```

Exit code 2, 2 warnings / 2 rule types; manual review found **0 actionable detector issues**:

| Rule | Location | Assessment |
| --- | --- | --- |
| `broken-image` | `src/app/globals.css:165` | ProseMirror separator-img description in CSS comment, not an actual broken image |
| `side-tab` | `src/components/knowledge/markdown-prose.ts:7` | Neutral Markdown blockquote border-left, not a colored side-accent card |

Detector missed real interaction/contrast/component-adoption issues such as F01, F03, F05/F06, so a clean detector cannot establish UI/UX acceptance.

Browser evaluate supports read-only operations, preventing detector-script injection. No live overlay, overlay-console findings, or detector live server; browser evidence uses real page screenshots, AX/DOM, and computed-style measurements.

## Recommended implementation order

1. **Confirmed defects first:** F01 shared-long-document scrolling, F05 import-field adoption, F06 hint contrast, F14 duplicate share title. Independently verifiable, suitable for small PRs.
2. **Daily interface next:** F04 Home DocumentRow/action hierarchy, F07 palette ranking, F08 list navigation, F09 copy/labels, F13 favorites Show all.
3. **Separate shell/editor spec:** F02 unified navigation/header and F03 stable geometry/sticky actions; verify F10 responsive layout together. Do not replace the entire shell inside a mechanical polish PR.
4. **Evidence-driven follow-up:** F11 large-data query/presentation measurements, F12 revision diff, F15 enforcement corrections; F16 palette comparisons last.

## Follow-up design decisions

- Should Personal Home primarily serve continuing writing or comprehensive document organization? This audit recommends recent work first, with organizing through a clear entry point.
- After merging left navigation, should Knowledge/Graph/Sources share a document explorer, or should only Knowledge expand it? Shell spec must define this, rather than one page's CSS.
- How should primary language/date display be determined? Establish policy before changing individual copy to avoid mixing.

## Reverification priorities

Add verification scoped to implementation changes, without rerunning unrelated tests across the repo. F01 uses real long documents and scroll interactions; F03 reading/editing origins, long-document Save, drafts, and rendered-wikilink round trips; F05/F06 actual compiled control styles/contrast; F02/F10 full desktop/mobile, keyboard, focus, drawer, and mounted-navigation flows. Assess performance only using production builds and fixtures representative of daily data volumes.
