# Document Composer — design specification

| Item | Content |
| --- | --- |
| Date | 2026-09-28 |
| Type | Design specification for pre-implementation review |
| Addresses | Item 2 of the UI/UX review against Linear; `frontend-design-language.md` §18 Open item 3 (editing and reading are separate pages, added by PR #61) |
| Reference contract | `docs/superpowers/specs/frontend-design-language.md` §7 (page containers), §10 (Focus and keyboard), §15 (component architecture) |
| Reference specifications | `2026-09-16-phase-5-human-authoring-design.md` (authoring API, 409 conflicts), `2026-09-24-keyboard-shortcuts-design.md` (`E`, `⌘Enter`, `Esc`) |
| Status | Implemented; see docs/superpowers/verification/2026-09-28-document-composer-verification.md. Section 11 (2026-09-29 amendment) supersedes decisions 1 and 3 and §6's preview and shortcuts. |

## 1. Current state (measured, not quoted)

Compared against `main` at `060b8eb`.

- Edit `…/[documentId]/edit` is a form with Title, a Markdown textarea, and Save/Cancel (`src/components/knowledge/document-editor.tsx:74-102`). `/knowledge/new` is another similar form (`new-document-form.tsx`). Neither resembles the document just read.
- When reading Markdown that opens with `#` H1, the reader shows no separate title; H1 serves as the visual title. Revision `title` still names sidebar, search, and the last breadcrumb segment (`src/lib/markdown-title.ts`).
- Titles therefore have two sources: revision `title` and the opening Markdown H1. Forms let users change both independently; changing H1 does not rename the document elsewhere.
- Upload title precedence is frontmatter → first H1 → filename. Frontmatter is stripped from Markdown and stored as revision metadata (`src/server/authoring-input.ts:45-57`). Web editing carries metadata unchanged into the new revision (`src/app/api/documents/[documentId]/route.ts`).
- Dirty detection exists (`document-editor.tsx:44`) but there is no leave protection: `src` has no `beforeunload`.
- `NewDocumentForm`'s `variant: "sidebar"` has no callers and is dead code.
- No editor package exists; rendering uses only `react-markdown` + `remark-gfm`.

## 2. Decisions

| # | Question | Decision | Rationale |
| --- | --- | --- | --- |
| 1 | Source or rendered editing | **Rendered editing with Milkdown by default, switchable to Markdown source** (§11) | Revised 2026-09-29. Initially source was chosen because rendered editors parse into an internal model and serialize again, potentially rewriting unchanged formatting (`*` to `-`, table spacing, unknown syntax) into a revision. The product now follows Linear's rendered editing and **accepts normalization**. Revisions are immutable, so the previous revision retains original content. Source mode remains available to inspect actual Markdown. |
| 2 | Editing titles | **Follow content**: metadata title → opening H1 → title field (§4) | One document has one title, with the same condition as the reader. Metadata takes precedence to match upload rules and avoid contradiction with revision `title`. |
| 3 | Preview | ~~Toggle in the same column~~ **Superseded**: rendered mode is the preview; a rendered/Markdown toggle replaces Preview (§11) | The original rationale remains: no split pane and no extra revision merely to inspect formatting. Rendered mode satisfies it directly. |
| 4 | Leaving unsaved changes | **Tab-local storage (`sessionStorage`) and restore**, plus `beforeunload` | Next App Router has no in-app navigation interception API, and confirmation cannot reliably intercept browser Back. Storage covers every leave path without creating revisions. |
| 5 | Scope | **Create and edit share one composer** | Updating only one would produce two editors with different title rules. |
| 6 | Routes | **Keep `/edit` and `/new`, matching the reader's layout** | Server access checks (`edit/page.tsx:18-23`) remain at entry; retain post-save navigation fixed in #49/#59/#60; refresh stays in the editor. In-place switching would move authority checks to the client, rely on `router.refresh()` (the cause of #49), and overturn #58's full-load Edit decision. |
| 7 | Title rules | **Shared client-side pure function; API contract unchanged** | Title/H1 agreement is a Web presentation convention, not a domain invariant. `PATCH`/`POST` still accept explicit `title`; other callers such as MCP may choose it independently. |

## 3. Layout and components

Edit, create, and read share the same structure: a `pt-5 pb-3` row inside `kh-reading-column` with breadcrumb left and actions right, followed by same-width `py-6` content. Differences from reading:

- Right actions are **rendered/Markdown toggle** (`aria-pressed`, §11; initially Preview), **Cancel**, and **Save**, replacing Edit/Share/Details.
- The final breadcrumb updates to the title to be saved. Creation starts with `New document` and changes after title resolution.
- Content defaults to editable rendered content (§11); Markdown mode is a borderless textarea.

| Unit | Location | Responsibility | Dependencies |
| --- | --- | --- | --- |
| `DocumentBreadcrumb` | Extracted from `document-header.tsx` | Breadcrumb only, shared by reader and composer | None |
| `documentLocation` | `src/server/document-location.ts` | Derive source › folder path from the tree, excluding document; reader and `/edit` append their titles | Explorer model |
| `resolveAuthoredTitle` | `src/lib/authored-title.ts` | Pure function (§4) | `mdast-util-from-markdown`, `mdast-util-to-string` |
| Draft store | `src/lib/document-draft.ts` | Pure read/write/remove with injected `Storage`; `browserDraftStorage()` returns tab `sessionStorage` | None |
| `DocumentComposer` | `src/components/knowledge/document-composer.tsx` | Title when needed, rendered/source body, actions, errors, restoration hint; `blocked` reserves the page for another operation such as upload; `footer` render prop `(state: { busy }) => ReactNode` renders outside `<form>`; save supplied externally | Above units, `MarkdownRenderer`, `useFormKeys` |
| `DocumentEditor`, `NewDocumentForm` | Existing files | Thin wrappers supplying initial values and calling `PATCH`/`POST` | `DocumentComposer` |

Implementation merged `useDraft` into the draft store: three calls do not need a hook.

- Remove the `sidebar` variant. Upload remains on the creation page, whose composer uses upload state as `blocked` and upload buttons as `footer`, preserving mutual exclusion between typing and uploading.
- Unchanged: routes, server authorization, API contract, post-save navigation (`refreshOnArrival` + `router.push`), and reader behavior.
- `/edit` additionally supplies `location` (`documentLocation(...)`, source/folders without document) and `metadataTitle` from the current revision; the composer appends the resolved title.

## 4. Title rules

`resolveAuthoredTitle({ metadataTitle, markdown, typedTitle })` returns `{ title, source }` in this order:

1. Nonempty trimmed string `metadataTitle` → `source: "METADATA"`. Only uploaded documents with frontmatter title have this.
2. `markdownOpensWithHeading(markdown)` and nonempty trimmed text of the opening H1 from mdast `toString` → `source: "H1"`. Extraction matches import; the Chinese test example `# **季度** 目標` resolves to `季度 目標`.
3. Otherwise `typedTitle.trim()`, `source: "TYPED"`.

Check the **opening** H1, rather than import's first H1, to match the reader's visual title.

Display rules:

- Show the large borderless title field above the textarea only for `source === "TYPED"`, with `aria-label="Title"`.
- For `METADATA`, a caption under the breadcrumb explains that the title comes from uploaded frontmatter, so changing H1 does not rename it.
- When deleting the opening H1 changes `H1` to `TYPED`, prefill the last H1 text rather than suddenly blanking the name.
- Empty resolution disables Save; `useFormKeys` also blocks `⌘Enter` through submit-button `disabled`.
- Always submit the resolved `title`; the server's `MAX_TITLE_LENGTH` still enforces length.

## 5. Draft storage and restoration

**Storage**

- Edit key: `kh:draft:edit:<documentId>`; create key: `kh:draft:new:<workspaceId>`.
- Value: `{ v: 1, title, markdown, baseRevisionId }` (creation omits `baseRevisionId`). Store the typed title, not the resolved title.
- Write when content differs from initial values; remove when restored to initial values.
- Wrap all storage access in try/catch. Quota errors, private mode, corrupt JSON, and version mismatches mean no draft; show no error and do not disrupt editing.

**Restoration**

- Read after hydration: server has no `sessionStorage`, and forms already await hydration.
- Enable fields and Save only after `restoreChecked`. Enabling immediately at hydration allows typing before storage reads finish, then late restored content overwrites that input.
- Restore a draft and show a restored-unsaved-changes notice with Discard above content.
- If draft `baseRevisionId` differs from current revision, still restore it but use its base as `expectedCurrentRevisionId`. Explain that the document changed while away. Save follows the existing 409 path rather than silently overwriting others.

**Clear** on successful save, Cancel, or Discard.

**Leaving**

- Cancel with changes uses `window.confirm("Discard changes?")`, already used on creation and added to edit. On confirmation, clear the draft and leave.
- `Esc` still does nothing with changes; §11.6 covers both modes.
- Attach `beforeunload` only when dirty to guard tab close. Refresh also triggers it because browsers cannot distinguish the two, but storage survives leaving.
- Do not intercept in-app sidebar/palette/Back navigation; restore from storage.

## 6. Preview, shortcuts, and input area

**Preview (superseded by §11)**

Rendered mode is the preview. Remove the original Preview button, `⌘/Ctrl ⇧ P`, and Esc-from-preview behavior. The input rules below now describe the **Markdown-mode** textarea. See §11.6 for shortcuts.

**Input area (Markdown mode)**

- No border/background; use reader body font and size, not monospace. Consequently table and code-block source does not align.
- Grow to `scrollHeight` on input; scroll the page, without nested scrollbars.
- Autofocus on entry with the cursor at the beginning.
- Title, textarea, and rendered editor **omit `kh-focus-ring`**. Text fields always satisfy `:focus-visible`, so a ring would surround the entire canvas throughout editing. The caret indicates focus; toggle/Cancel/Save retain rings. Record this exception to design-language §10.
- `E` still fully loads `/edit` from reading (#58).

## 7. Error handling

- Keep `GovernanceError` above content without changing input.
- **409 conflict**: the existing reload-latest link targets `/edit`; draft restoration would reload the old base and cause another conflict indefinitely. Clear storage before full loading and label the action to explicitly discard changes. Current input remains visible before activation for manual copying.
- Storage failures are silently ignored as in §5.
- Empty resolved title disables Save with explanatory button `title`.
- **Discarded post-save navigation**: client navigation from `/edit` occasionally gets discarded after its response arrives; the old editor on `main` shows this too (see verification measurements). After successful save or confirmed Cancel, if composer remains mounted for 3 seconds, fully load the destination. Unmount cancels this fallback. Leaving is already decided, so fallback is correct; track router cause separately.

## 8. Tests

List scenarios before writing tests.

**Unit (Node)**

- `resolveAuthoredTitle`: metadata priority; opening H1; plain-text extraction from inline formatting; nonopening H1 → `TYPED`; H1 containing only an image with empty alt → TYPED (nonempty alt is used, as in import); BOM/leading blank lines; empty or nonstring metadata falls through; typed-title trim; all-empty result.
- Injected fake `Storage`: write only changes, remove when reverting; corrupt JSON/version mismatch → `null`; storage exceptions do not escape; edit/create keys do not interfere.

**E2E (Playwright)**

- Opening H1 hides title field; changing H1 updates breadcrumb immediately; save updates sidebar name.
- Without H1, show title field; deleting opening H1 prefills its text.
- Uploaded frontmatter title: H1 edits do not rename, and explanation is shown.
- ~~Preview~~: replaced by §11.9 mode-switch tests.
- Draft: type, leave via sidebar, return with `E` → restoration hint; Discard clears it.
- Draft/conflict: another save while away → restored save gets 409; loading latest no longer restores the old draft.
- Cancel while dirty shows confirmation.
- Creation with only H1 succeeds using its title.
- Update selectors in `phase5-authoring.spec.ts` and `keyboard-shortcuts.spec.ts`: fields are consistently `Title` and `Markdown`; creation no longer uses `Document title`.

**Manual**: see §11.9 for Firefox `Ctrl /` and Zhuyin IME.

**Completion**: all `make verify` and `make test-e2e` checks pass, with a verification record.

## 9. Out of scope

- Source-mode syntax highlighting and rendered-mode slash menus. Rendered editing and selection toolbar are included from §11 onward.
- Autosaving revisions; cross-tab/device drafts (`localStorage` or server drafts).
- Confirmation intercepting in-app navigation.
- Server enforcement of title = H1.
- Web metadata/frontmatter editing: Phase 5 §6.3 remains unchanged.

## 10. Other documentation affected

- `frontend-design-language.md` §10: add `⌘/Ctrl /` for rendered/Markdown; remove initially added `⌘/Ctrl ⇧ P` and preview Esc. Record the canvas focus-ring exception (§6). §18 item 3, added in PR #61, is closed by implementation.
- `2026-09-24-keyboard-shortcuts-design.md` §5 points to this specification's §6.
- README canonical table adds this specification and implementation plan.

## 11. Rendered editing (2026-09-29 amendment)

The product requires Linear-like editing: edit formatted content by default and switch to inspect actual Markdown. This section supersedes decisions 1/3 and §6's preview/shortcuts. Title (§4), draft (§5), and error (§7) rules remain because they depend only on `markdown` strings.

### 11.1 Trade-offs and dependencies

- Always default to rendered editing and **accept normalization**. First rendered edit serializes the whole document, potentially changing untouched `*` bullets, table spacing, or unknown syntax. Do not automatically switch to source for non-round-trippable content or warn before saving.
- This product choice can lose data: unknown syntax may change or disappear in the new revision. Mitigations are only the preceding revision's original content and spike measurements of common syntax (§11.8), recorded in verification.
- Add `@milkdown/kit` 7.22.x (ProseMirror/remark, same family as reader `remark-gfm`) and development `jsdom` for round-trip unit tests. **Do not use** `@milkdown/react`: it depends on Crepe types, whose theme CSS violates the `kh-*` color-token rule. Mount through the imperative API. The earlier no-new-package restriction no longer applies here.

### 11.2 Modes and single source of truth

- `mode: "rendered" | "source"`, default `rendered`. Source uses §6's unchanged textarea.
- The `markdown` string remains the **only state source**. The editor is its view; title, drafts, dirty state, conflicts, and save read it.
- **Parse on opening without writing back.** Retain the original string so merely opening does not mark dirty through normalization.
- The **first user edit**, excluding programmatic ProseMirror transactions, immediately sets `touched` and dirty, enabling `beforeunload`/Cancel protection even before serialization.
- **Output:** editor → Markdown. Milkdown listener debounces approximately 200ms and emits only actual document changes, updating `markdown`. **Flush immediately** by reading editor state on save, mode switch, `pagehide`, `visibilitychange` to hidden, and unmount. Cancel discards, so it needs no flush; `touched` already prompts confirmation. After flush, clear `touched` if Markdown equals initial content; normalization differences keep dirty.
- **Source → rendered:** replace the editor document when source changed; this clears editor undo history. Unchanged text leaves it intact. Undo does not cross modes.
- Save always flushes before submitting Markdown and its resolved title.

### 11.3 Titles

Keep `resolveAuthoredTitle` and §4, reading the Markdown string. Rendered-mode breadcrumb/title updates follow **serialized output**, with roughly 200ms delay. Do not infer approximate titles from editor nodes: that can disagree with mdast for image-alt-only H1 or inline formatting and is not worth saving 200ms.

- **Submitted titles always come from the flushed Markdown**, matching reader/import rules.
- Keep TYPED title field, METADATA notice, and prefill when deleting opening H1.
- In rendered mode, METADATA content without an opening heading shows its title as a read-only `<h1>` above the body, matching the reader. TYPED already has a field and is not duplicated.

### 11.4 Editing experience

- **Typing transforms:** `# ` through `### `, `- `, `1. `, `> `, triple backticks, `**bold**`, `*italic*`, and inline backticks. GFM includes tables and task lists.
- **Shortcuts:** `⌘/Ctrl B`, `⌘/Ctrl I`. **Do not bind `⌘/Ctrl K`**, reserved for global palette search. Links use the floating toolbar; activating Link replaces it with inline URL input (Enter applies, Esc cancels). All toolbar buttons must be `type="button"` inside the form to avoid saving, and prevent default on `mousedown` to preserve selection.
- **Selection toolbar:** show bold, italic, link, H1/H2, bullet list, numbered list on selection; no slash menu. Respect control-height hierarchy and focus rings; `aria-pressed` reflects state.
- **Resolved deviation (#68):** instantaneous toolbar visibility violated §9's overlay entrance/exit rule. `@starting-style` and discrete `display` transitions now use existing `duration-120`/`ease-out` tokens; no new tokens. Global rules handle reduced motion. Reader `⌘/Ctrl I` opens Details, but edit has no inspector, so the editor uses it for italic.
- **Shared reader styling:** extract `MarkdownRenderer`'s outer class string into a shared constant for reader/editor to prevent drift.
- **Images:** retain reader allowlist (`markdown-image-policy.ts`). Disallowed sources get an **empty `src`** in editor DOM: no request and an empty frame, rather than reader “Image blocked”. Content/output retain the original URL; clipboard carries it in `data-kh-src` to preserve copy/paste. **Deviation from draft:** originally planned a `MarkdownImage` node view matching reader fallback. Schema handling was used because image DOM also serializes clipboard content, beyond node-view control.
- **Links:** clicking does not navigate; `⌘/Ctrl`+click opens a new tab, matching reader external links.
- **Output:** always `-` bullets and `---` rules rather than Milkdown defaults `*`/`***`, avoiding wholesale rewriting on first edit.
- **Image-title patch:** Milkdown 7.22.2 parses titleless `![alt](url)` into mdast `title: null`, rejected by ProseMirror attribute validation, throwing and emptying the whole document. A remark plugin changes null to empty string before parsing; measured to fix it. This patch is required, not an optimization.

### 11.5 Loading

- Load the editor with `next/dynamic` (`ssr: false`); measured Milkdown/ProseMirror stay out of `/edit` and `/new` initial bundles. Reader react-markdown/remark-gfm remain because loading fallback `MarkdownArticle` and `authored-title` need them. The earlier follow-up about eagerly loaded preview Markdown packages is **not resolved** here.
- Show read-only reader `MarkdownArticle`, server-renderable, while loading; replace in place when ready without flashing a textarea. Rendered-mode fields/Save require editor readiness; source mode does not otherwise wait, but its textarea is disabled until editor readiness or confirmed failure/source fallback.
- Focus unchanged: empty title field first when present, otherwise the beginning of the body/editor. Same for restored drafts.
- **Failure guard:** construction failure or empty parsed output for nonempty Markdown switches to source with explanation, without accepting empty output. This guards catastrophic parsing failure such as images above; it is not the rejected general warning for normalization.
- Both rendered and textarea areas stay mounted and use `hidden`, without display classes on that element.
- Once leaving through Cancel/load-latest begins, ignore late debounced output; otherwise discarded drafts reappear in storage and are restored later.
- Record the editor's opening Markdown as its sync baseline, reported through `RenderedEditor.onReady`. Dynamic loading may mount on a later render after draft discard; compare this baseline and replace stale displayed content. Source input is disabled before readiness as above.
- Source-to-rendered replacement uses the same guard as opening: exceptions or `parsedIntact === false` keep source mode with the same notice. Chunk-load failure also falls back to source.

### 11.6 Shortcuts and Esc

| Key | Behavior |
| --- | --- |
| `⌘/Ctrl /` | Toggle rendered/Markdown, following Typora convention |
| `⌘/Ctrl Enter` | Save unchanged. ProseMirror binds it as handled/no-op; otherwise inside code/tables it inserts an exit paragraph serialized as `<br />`. The event still bubbles to form `useFormKeys` for saving. |
| `Esc` | Leave only when unchanged and not saving; otherwise do nothing, in both modes |
| `⌘/Ctrl ⇧ P` | Removed |

- Extend form-local `useFormKeys`, with no new global listener. Suppress during IME composition (`isComposing`/`keyCode 229`).
- Removing `⌘⇧P` removes the earlier Firefox private-window conflict. No known browser reservation exists for `⌘/Ctrl /`, but manually verify Firefox.

### 11.7 Unchanged behavior

- Drafts store flushed Markdown; restoration, base revision, 409, clearing, `beforeunload`, Cancel confirmation, and navigation fallback (§§5/7) remain.
- Upload, `blocked`/`footer`, title-source explanations, and METADATA precedence remain.
- Routes, server authorization, and API contract remain.

### 11.8 Measurements and remaining spike

**Measured 2026-09-29 in headless jsdom: Milkdown 7.22.2 + commonmark + gfm, output configured as §11.4.**

| Outcome | Content |
| --- | --- |
| Preserved | Headings; `-` and ordered lists; `_` emphasis and `**` bold; fenced code with language; inline code; links with/without title; autolinks; images with alt/title using the patch; block/inline HTML; footnotes; quotes; tasks; `---`; CJK text; `[[X]]` wikilinks with aliases/headings written intact by `wiki_link` nodes (see [daily-driver §4](2026-09-29-personal-daily-driver-design.md)) |
| Normalized | `*` lists → `-`; table separators `\|---\|` → `\| - \|`; two trailing spaces → backslash break; setext `===` headings → `#`; unnecessary escapes (`1\.` → `1.`). **`[[X]]` → `\[\[X]]` is no longer accepted:** originally wikilinks were plain text, but after #78 indexed them, this transformation loses links/backlinks/graph edges and is a defect, not a trade-off. |
| Failure | Titleless images threw during parsing and emptied the whole document; patched and protected by fallback |

- CommonMark does not interpret `_斜體_` adjacent to CJK text as emphasis; reader also shows underscores. Editor escapes both (`與\_斜體\_，`) while preserving display. This depends on locked `mdast-util-to-markdown` 2.1.2; 2.1.3 no longer escapes opening intraword underscores. The Chinese example in `tests/unit/markdown-editor.test.ts` flags upgrades.
- Project Vitest can run round trips with `// @vitest-environment jsdom` and installed `jsdom`.

**Browser spike (Task 3 gate, passed; see verification)**

1. Mount with `ssr: false` under Next 15/React 19 without hydration warnings or duplicate editors from StrictMode effects.
2. Milkdown tooltip/floating-ui toolbar positions correctly and is not clipped by the reading column.
3. Measure added bundle size and confirm loading only on `/edit`/`/new`.

If mounting or toolbar is infeasible, **stop and report** rather than forcing it; retain this PR's completed source editor.

Other risks: **IME** composition transforms require manual verification; accessibility roles/names and toolbar keyboard interaction require E2E checks.

### 11.9 Tests

**Unit (Vitest/jsdom):** fix each §11.8 round-trip input/output as assertions, documenting normalization and preventing regressions; image-title patch; disallowed image `src` empty in DOM; user-edit detection (construction/whole-document replacement do not trigger, input does); failure-guard predicate.

**E2E**

- Default rendered mode; leaving without edits is clean with no `beforeunload`.
- Typing `# ` makes a heading, `- ` a list, `**x**` bold.
- Selection shows toolbar; Bold followed by source mode reveals `**…**`.
- Source edits appear after returning to rendered mode; mode changes preserve unsaved content.
- Rendered H1 changes title; saved title agrees with reader.
- Rendered edits survive leave/return with restoration notice; 409 remains unchanged.
- Disallowed images do not load in editor.
- `⌘/Ctrl /` switches; `⌘/Ctrl Enter` saves in rendered mode.
- Existing tests directly filling `getByLabel("Markdown")` must first switch to source through a shared helper or type into rendered mode.

**Manual, recorded in verification:** Firefox `Ctrl /`; Zhuyin composition/typing transforms; open/edit/save a real imported document with tables/code and inspect differences.

### 11.10 Completion criteria

- Browser spike passes with bundle measurements in verification.
- `make verify` and `make test-e2e` pass; repeat the complete `document-composer.spec.ts` file 15 times without failure.
- Update design-language §10 (shortcuts and rendered-canvas focus exception) and README.
