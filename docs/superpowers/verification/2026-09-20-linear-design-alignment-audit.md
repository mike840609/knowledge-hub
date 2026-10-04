# Linear Design Alignment — Audit Record

**English** | [繁體中文](2026-09-20-linear-design-alignment-audit.zh-TW.md)

| Item | Details |
| --- | --- |
| Date | 2026-09-20 |
| Type | Audit record (point-in-time snapshot, not a tracking list) |
| Branch tested | `claude/ui-ux-linear-alignment-uqvmj4`, HEAD `4dfdb95` |
| Related PR | [#42](https://github.com/mike840609/knowledge-hub/pull/42), 10 commits, 69 files +1254/−279 |
| Reference contract | `docs/superpowers/specs/frontend-design-language.md` (living contract) |

## Purpose of this document

This is a **historical record** of a UI/UX audit: findings, resolutions, and what remained at that time.

**The canonical source for unfinished items is the living contract's “Open items” section, rather than this record.** Unfinished fields here are snapshots from the audit and become outdated; read the contract for current outstanding work. This follows README's distinction between canonical specs and architecture history.

The audit began by examining alignment with Linear design principles. It found a deeper issue than a missing system: **the existing contract was not followed**—Phase 2.5 §25–30 already specified visual rules, but they were buried in a dated phase document, so existing implementation and this work's first revision unknowingly violated them. Moving the contract (finding 22) addressed the root cause.

---

## Overview

| Category | Complete | Incomplete | Subtotal |
| --- | --- | --- | --- |
| 1. Token system | 6 | 1 | 7 |
| 2. Component system | 4 | 4 | 8 |
| 3. Themes and colors | 4 | 0 | 4 |
| 4. Interaction model | 3 | 5 | 8 |
| 5. Layout and documentation | 3 | 4 | 7 |
| **Total design findings** | **20** | **14** | **34** |
| 6. Verification gaps | — | 3 | 3 |

---

## 1. Token system

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| 1 | 9 font sizes: mixed `text-sm`/`xs`/`2xl`/`[13px]`/`[15px]`/`[11px]`/`[10px]`/`lg`/`xl`/`base`. Same-level headings vary by route—`PageHeader` 20px, 14 pages manually set 24px | ✅ Complete | `601b948` |
| 2 | 5 spellings for corner radii | ✅ Complete | `601b948` |
| 3 | Shadows lack an elevation system; `sm/md/lg/xl` each used 1–2 times | ✅ Complete | `601b948` |
| 4 | Two focus idioms coexist: 22 `focus-visible:outline` uses versus 54 `ring-2`; two adjacent buttons in `knowledge-empty-state` use different idioms | ✅ Complete | `601b948` |
| 5 | Hardcoded colors bypass tokens: `amber-50`, `red-200`, `red-700`, three `bg-black/*` values | ✅ Complete | `601b948` |
| 6 | No motion system: 5 transitions and 1 animation across the repo, overlays appear instantly; only 1 `prefers-reduced-motion` accommodation | ✅ Complete | `a1c82a7` |
| 7 | `spacing` is the only unreplaced scale, leaving gap/padding unconstrained | ❌ Incomplete | Contract Open items |

**Approach adopted**: all scales in `tailwind.config.ts` **replace** rather than extend, so `text-[13px]`, `rounded-xl`, and `shadow-sm` compile to no CSS; `borderRadius` has no `DEFAULT`, so bare `rounded` also fails. This is the key to moving enforcement from review to the compiler.

---

## 2. Component system

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| 8 | Shared `Button` is `min-h-10` (40px), while shell controls are actually 32/36px, causing **21 manually written** `inline-flex … rounded-md …` controls instead of imports | ✅ Complete | `287c220` |
| 9 | Only primary/secondary variants, missing ghost/danger/link | ✅ Complete | `287c220` |
| 10 | Destructive operations use the primary color: Archive workspace/Confirm archive shown in purple primary | ✅ Complete | `287c220` |
| 11 | Badge states cannot be scanned: success/warning/danger share `bg-kh-bg-hover`, differing only in text color | ✅ Complete | `0a70605` |
| 12 | `search-form.tsx:22` overrides `<Button>` shape with `className="m-1 min-h-9 px-4 py-1.5"`—exactly the drift the button system should prevent, missed by finding 8's scan because it is not manually written `inline-flex` | ❌ Incomplete | Contract Open items |
| 13 | `Input` 40px and `search-form` input 44px do not use Button's size scale, leaving adjacent form controls misaligned | ❌ Incomplete | Contract Open items |
| 14 | Menus manually use native `<details>` (`workspace-selector`, `source-sidebar`); Base UI `Menu` unused (only button/dialog/tabs used). No arrow navigation or roving focus. **Violates the contract's own “every list supports arrow navigation” rule** | ❌ Incomplete | Contract Open items |
| 15 | Three loading patterns: skeletons, `Loading documents…`, `Searching…`; `knowledge-layout`'s `DocumentRegionSkeleton` and `loading.tsx` almost duplicate line by line | ❌ Incomplete | Contract Open items |

---

## 3. Themes and colors

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| 16 | **No dark mode at all**: hardcoded `color-scheme: light`, 0 `dark:` uses across repo | ✅ Complete | `26f42bf` |
| 17 | Neutrals differ in hue: 4 near-gray colors, warm `--kh-reading-bg` against otherwise cool tones, juxtaposed at the topbar↔nav seam | ✅ Complete | `601b948` |
| 18 | Dark dividers too bright: border L\* **18.44** > hover fill L\* **15.19**, static structural lines brighter than interaction states, reversing hierarchy | ✅ Complete | `2caef27` |
| 19 | Control borders fail WCAG 1.4.11: `Input`/`Textarea`/secondary-button background matches canvas, making border the only boundary, but dark **1.34:1**, light **1.24:1** (3:1 required). **Both themes fail; existing issue** | ✅ Complete | `2caef27` |

**Value selection**: color decisions use relative luminance, L\*, and contrast calculations rather than visual judgment. `border-strong` is checked against **every potentially adjacent surface**—first candidates pass on canvas (3.25/3.23) but fail on `subtle`/`sunken` (2.91/2.88).

---

## 4. Interaction model

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| 20 | Full-text search page has no keyboard navigation: ⌘K palette supports arrows/Enter/`aria-activedescendant`, while `/search` has none—the weaker implementation is where more results create greater keyboard need | ✅ Complete | `4dfdb95` |
| 21 | Scroll position always resets to zero; returning to lists loses reading position | ✅ Complete | `4dfdb95` |
| 22 | Search-result metadata forms one sentence, preventing vertical scanning (the same repo's `source-list-row` is a correct comparison) | ✅ Complete | `4dfdb95` |
| 23 | ⌘K searches only, with no actions. New note/toggle archived/open Details lack keyboard paths and shortcut overview | ❌ Incomplete | Contract Open items |
| 24 | No toast/undo layer. Feedback uses layout-expanding `role="status"` paragraphs; **0 explicit `aria-live` uses across repo**; destructive actions require inline two-stage confirmation instead of “act then offer undo” | ❌ Incomplete | Contract Open items |
| 25 | No context menus. Rename/archive/copy link require opening the document page | ❌ Incomplete | Contract Open items |
| 26 | Tree expansion, source expansion, and filter text use `useState`, lost on reload | ❌ Incomplete | Contract Open items |
| 27 | **Navigation is not instant**: each document click makes a server round trip, with only one `loading.tsx` boundary across the app. **Largest perceived gap and the only architecture issue**—measure before deciding prefetch/caching strategy, rather than a CSS change | ❌ Incomplete | Contract Open items |

---

## 5. Layout and documentation

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| 28 | Violates existing §26: `ui/textarea` has a shadow (normal surfaces should not), panels use overlay radii, sidebar dropdowns do not use overlay radii | ✅ Complete | `0c8ac6a` |
| 29 | **Design contract buried in a dated phase document**: Phase 2.5 §25–30 specifies visual language, tokens, component architecture, state strategy, and domain boundaries, but no one reads it after Phase 2.5—**the root cause of all drift in this audit** | ✅ Complete | `76c3619` |
| 30 | No `CLAUDE.md` | ✅ Complete | `76c3619` |
| 31 | Settings navigation has no active state and does not use existing `ui/tabs`; **7** container widths and 3 page-padding values | ❌ Incomplete | Contract Open items |
| 32 | Empty/error states consist only of heading plus paragraph; knowledge empty state has two equally weighted CTAs | ❌ Incomplete | Contract Open items |
| 33 | `error.tsx`/`not-found.tsx` cover only `knowledge/[sourceId]/`; `/search`, `/sources`, `/settings` have no boundaries, nor is there `global-error.tsx` | ❌ Incomplete | Contract Open items |
| 34 | Hardcoded `en-US` date formats (3 locations) | ❌ Incomplete | Contract Open items |

---

## 6. Verification gaps

Three evidence deficiencies recorded at audit time **have now all been filled**. Original records remain because their absence then is itself part of this history.

| Item | At audit time | Current status |
| --- | --- | --- |
| Dark-theme visual inspection | ⚠️ Only one manual inspection | ✅ App running against real database; screenshot comparisons in light/dark themes before/after changes |
| Automated keyboard-navigation tests | ❌ None | ✅ Two cases added to `phase4-search.spec.ts`: arrows between rows, Up returns from list to query input, Home/End, Enter opens |
| UI primitive render tests | ❌ None | ✅ 11 cases in `tests/unit/ui-primitives.test.tsx` cover `buttonClasses` variant × size × icon matrix and actual `Button`/`Badge` renders |

Two useful lessons from adding coverage:

- **No dependencies added.** Existing `react-dom`'s `renderToStaticMarkup` covers pure presentation primitives without testing-library or jsdom.
- `tsconfig.json`'s `jsx: "preserve"` is for Next, leaving esbuild on classic runtime and causing `React is not defined` on render. `vitest.config.ts` therefore sets `esbuild: { jsx: "automatic" }`, affecting tests only.

The Badge case explicitly locks down the corrected regression: success/warning/danger background tokens must **all differ**—they once shared `bg-kh-bg-hover`, differing only in text color.

## Subsequent updates

Audit status fields snapshot `4dfdb95` and **are not updated for later work**—the contract's Open items remain canonical. This section records later events, explaining which ❌ findings above no longer apply.

| # | Finding | Resolution |
| --- | --- | --- |
| 14 | Manually written `<details>` menus lack arrow navigation | ✅ [#43](https://github.com/mike840609/knowledge-hub/pull/43) — `ui/menu.tsx` wraps Base UI `Menu`, both menus converted |
| 12 | `search-form` overrides Button shape through `className` | ✅ This batch |
| 13 | `Input`/`Textarea` lack size scale | ✅ This batch — height scale extracted to `ui/control.ts`, shared by buttons/fields |
| 15 | Three loading patterns, duplicate skeletons | ✅ This batch |
| 33 | error/not-found cover one route only | ✅ This batch |
| 34 | Hardcoded `en-US` dates | ✅ This batch — consolidated in `lib/format-date.ts` |

Fixing 12 revealed a broader problem: beyond overriding Button, `search-form` has a 44px input and two manually written `<select>` controls. Further investigation found **all five manually written `<select>` controls use `border` rather than `border-strong`**—finding 19's WCAG 1.4.11 issue remained unchanged in selects, missed because the scan covered only files importing `Input`/`Textarea`. Contract §6 was consequently rewritten as a rule rather than a component list.

### Two wording corrections

Original text retained; corrections recorded here:

- **Finding 24's “0 `aria-live` uses across repo”** is literally correct but overstates the gap. `role="status"` has implicit `aria-live="polite"` and is used in this repo; the missing feature is a toast/undo layer, rather than all announcements. Contract Open items rewritten.
- **Finding 34 records “3 locations,” actually 5**: the second formatter in `search-result-row` and `new Intl.RelativeTimeFormat("en")` recreated on every render in `document-header` also count.

### New gap discovered by this batch

Timestamps use the runtime's own timezone, causing hydration mismatch when server/client timezones differ. Actual comparison: `Mar 4, 2026, 9:05 PM` (UTC) versus `Mar 5, 2026, 5:05 AM` (Asia/Taipei)—even the dates differ. Added to contract Open items, **unfixed**: like locale, this is a product decision (resolve server-side or render only on client), rather than a formatting issue.

## Execution record

10 commits, each independently reviewable and green:

| Commit | Changes |
| --- | --- |
| `601b948` | Tokenize font sizes, radii, elevation, focus, and neutral ramp |
| `287c220` | Unify button system |
| `0a70605` | Badge state tones |
| `a1c82a7` | Motion system |
| `83d20d3` | Load Inter and tabular numerals |
| `26f42bf` | Dark theme |
| `0c8ac6a` | Fix §26 violations |
| `76c3619` | Promote contract to living contract; add CLAUDE.md |
| `2caef27` | Darken dark dividers; extract `border-strong` |
| `4dfdb95` | Search-page keyboard navigation, scroll restoration, scannable rows |

All four CI jobs (`unit`/`build`/`integration`/`e2e`) passed at every head. `lint`, `typecheck`, `build`, and 316 unit tests ran locally before each push.

## Recommended follow-up order

1. **Findings 12, 14** — gaps left by this work itself (one system gap, one contract gap), prioritized above remaining items
2. **Findings 15, 33** — inexpensive and convenient
3. **Findings 7, 31, 34** — mechanical, using a verified approach
4. **Findings 23, 24, 25** — behavior changes; CLAUDE.md's “substantive design changes get a spec before code” requires a spec first
5. **Finding 27** — independent architecture decision; measure before deciding scope

After groups 1–3, presentation alignment is largely complete; only finding 27 materially affects perceived responsiveness.
