# Editor Notion parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Implement the 22 decisions of the editor Notion-parity spec, in five slices grouped by the code they touch.

**Spec:** `docs/superpowers/specs/2026-11-15-editor-notion-parity-design.md` (decision numbers below refer to it).

**Tech Stack:** Next.js 15, React, Milkdown 7 / ProseMirror, Tailwind with the project's replaced scales, Vitest (jsdom), Playwright.

## Global Constraints

- Read `CLAUDE.md` and `docs/superpowers/specs/frontend-design-language.md` before touching `src/components` or `src/app`. Tailwind's default `text-sm`, `rounded`, `shadow-sm`, `duration-150` etc. compile to nothing: use the contract's tokens. Colour only through the CSS variables in `src/app/globals.css`.
- No new runtime dependency. `lucide-react` is already installed.
- Every change that rewrites the document goes through the rendered editor and keeps wikilinks intact. Any change to the editor or the Markdown it writes needs a test that runs the *rendered* editor and reads the links a saved document holds (`tests/unit/editor-wikilinks.test.ts`, `tests/fixtures/link-markdown.ts` show how).
- The reader never passes HTML through; do not add `dangerouslySetInnerHTML` or `rehype-raw`.
- Keys are never bound during IME composition (`event.isComposing` / keyCode 229), matching existing handlers.
- When a slice changes something the design-language contract describes (block controls, `/` list, `[[` list, menus, toolbar), amend that section of `frontend-design-language.md` in the same commit.
- Commit on the current branch (`claude/wonderful-dijkstra-fak5kh`); do not push. End commit messages with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01N59NajKAtrdFpUvtSETfyD`. No model names elsewhere in commits or code.

## Commands

- Focused unit test: `npx vitest run --config vitest.config.ts tests/unit/<file>.test.ts`
- Before committing: `npm run test:unit && npm run typecheck && npm run lint`
- One e2e spec (builds the app, ~4 min first time): `service mariadb status >/dev/null || service mariadb start; LANG=C.UTF-8 KM_TEST_DB_ADMIN_USER=root KM_TEST_DB_ADMIN_PASSWORD=hcm_km_root KM_TEST_ADMIN_DATABASE=mysql npm run test:e2e -- --reporter=line --trace off tests/e2e/<spec>.ts`
- Run every e2e spec you add or change, plus the existing editor specs your files are covered by (`grep -l` the module name under `tests/e2e`).

### Task 1: Typing rules and editor keys

Decisions 1–8. Files: `src/components/knowledge/editor/editor-core.ts` (plugin wiring), a new `src/components/knowledge/editor/notion-keys.ts` for the keymap and input rules, `src/components/knowledge/editor/block-actions.ts` (reuse its move/duplicate commands; do not duplicate them), `src/app/globals.css` (block node-selection style if needed), unit tests `tests/unit/editor-notion-keys.test.ts`, e2e `tests/e2e/zz-editor-notion-keys.spec.ts` for Escape block selection and `Mod-a`.

- [ ] Mark ends after an input-rule closing delimiter (1); typing after `**bold**` is plain.
- [ ] `[] `, `[ ] `, `[x] ` make to-do items (2); serialised Markdown is `- [ ] ` / `- [x] `.
- [ ] Typographic replacements (3), not in code blocks or inline code; Backspace straight after undoes one (ProseMirror `undoInputRule`).
- [ ] Backspace at heading start → paragraph (4).
- [ ] `Mod-Shift-s`, `Mod-Shift-7/8/9` (5); `Mod-Shift-ArrowUp/Down`, `Mod-d` (6) via block-actions.
- [ ] Escape → node selection of the current top-level block (7). Must not steal Escape from open menus (`[[` list, `/` list, block menu, toolbar link field) or from the code-block editor: those handlers run first.
- [ ] Two-stage `Mod-a` (8).
- [ ] Tests for each, through the rendered editor; wikilink round-trip for move/duplicate is already covered by block-actions tests — extend if you change them.

### Task 2: Title, links and the selection toolbar

Decisions 9–13. Files: `src/components/knowledge/editable-document.tsx` and/or `src/components/knowledge/document-composer.tsx` (title Enter/ArrowDown — both surfaces have a title field; apply to both), `src/components/knowledge/editor/selection-toolbar.ts` (toolbar items, link field, link card), `src/components/knowledge/editor/rendered-editor.tsx` if the editor needs to expose a focus-start method, the palette's `Mod-k` listener (find it with `grep -rn "\"k\"" src/components/shell`) so it yields when the editor handled the key, `src/app/globals.css`. Tests: unit for toolbar items and paste-URL-on-selection; e2e `tests/e2e/zz-editor-links-title.spec.ts` for title Enter/ArrowDown, `Mod-k`, the link card, Mod-click.

- [ ] Title Enter / ArrowDown → editor start (10), never a newline in the title; empty document gets an empty paragraph.
- [ ] `Mod-k` with selection opens the link field and the palette stays closed (9); without selection the palette opens.
- [ ] Link card on caret-in-link/click with Open, Edit, Remove; Mod-click opens a new tab (11). Wikilinks unchanged. Card uses popover elevation and menu tokens from the contract.
- [ ] Paste URL over selection links it (12).
- [ ] Toolbar adds Strikethrough, Inline code, Heading 3 (13), with active states.

### Task 3: Block controls layout and the `/` list

Decisions 14–16. Files: `src/app/globals.css` (`.kh-document-pane .kh-reading-column`, `.kh-editor-blocks`), `src/components/knowledge/editor/block-gutter.ts`, `src/components/knowledge/editor/slash-commands.ts`, the design-language contract sections "Block controls and the `/` list" and any reading-column layout text it changes. Tests: extend `tests/e2e/zz-editor-blocks.spec.ts` (controls do not overlap text at 1440×900 with both sidebars open, and at 1920; reader and editor left edges equal), unit for alias matching.

- [ ] Find why the column has no room for the 56px gutter at the default layout and change the layout minimally so it does (14). The reading and editing left edges must stay identical, and existing layout e2e specs (`reading-loading.spec.ts`, `review-layout.spec.ts`, `retrieval-layout.spec.ts`, anything asserting reading-column x) must keep passing — run them.
- [ ] `+` opens the `/` list on the new paragraph (15).
- [ ] Aliases and icons in the `/` list (16).

### Task 4: Toggle, table, code block and callout

Decisions 17–20. Files: `src/components/knowledge/editor/details-node.ts`, `details-toggle.ts`, `slash-commands.ts` (toggle insertion caret only), `table-actions.ts` or a keymap in `editor-core.ts` for table Tab, `src/components/knowledge/code-block.tsx` (editing header), the callout rendering in the editor (find with `grep -rn "\[!NOTE\]\|callout" src/components/knowledge/editor src/lib`), `src/app/globals.css`. Tests: unit through the rendered editor for each; e2e for the toggle layout (chevron on the summary line) in `tests/e2e/zz-editor-blocks.spec.ts` or a new spec.

- [ ] Toggle chevron inline, caret in summary on insert, Enter at summary end → body (17).
- [ ] Tab in last table cell adds a row (18).
- [ ] Code block language `<select>` and Tab/Shift-Tab indentation while editing (19); the fenced language is written to Markdown.
- [ ] Callout type menu (20); Markdown is `> [!TYPE]`.

### Task 5: Paste fidelity and the page icon picker

Decisions 21–22. Files: `src/components/knowledge/editor/editor-core.ts` (parseDOM rules or a paste transform), `src/components/knowledge/page-icon-picker.tsx`, a new `src/lib/emoji-catalog.ts`. Tests: unit pasting HTML into the rendered editor (`<s>`, `<strike>`, checkbox list items, a header-less table) and checking the Markdown it saves; unit or e2e for picker search (English and Chinese keyword).

- [ ] `<s>`/`<strike>` → strikethrough; checkbox list items → to-do; header-less table first row → header (21).
- [ ] Emoji catalog (~300, en + zh-TW keywords), search field, "Suggested" first (22). Keyboard navigable like the contract's menus.
