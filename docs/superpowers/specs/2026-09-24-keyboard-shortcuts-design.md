# Keyboard shortcuts — design specification

| Item | Content |
| --- | --- |
| Date | 2026-09-24 |
| Type | Design specification for pre-implementation review |
| Addresses | Item 1 of the UI/UX review against the Linear design language: keyboard interaction is the largest perceived gap |
| Reference contract | `docs/superpowers/specs/frontend-design-language.md` §10 (Focus and keyboard), §15 (One registry decides what can be done) |
| Reference specification | `docs/superpowers/specs/2026-09-21-action-model-spec.md` (origin of `Action.shortcut`) |
| Status | Implemented. Section 9 records existing defects discovered and fixed during implementation. The target of `E` (§2, the table row "E — the document being read" and the out-of-scope bullet about applying `E` to the focused row; §3.2) and the row menu showing no shortcuts (§4.4) are superseded by `2026-10-02-row-keyboard-actions-design.md`: the target follows keyboard focus, and the menu shows the keys. |

## 1. Current state (measured, not quoted)

Compared against `main` at `43fc857`.

**Only two site-wide shortcuts exist, each attaching a `window` listener in its component:**

```text
⌘K / Ctrl K   Open palette         src/components/search/quick-search.tsx:112–120
⌘I / Ctrl I   Open Details panel   src/components/knowledge/document-inspector.tsx:276–286
```

**The registry has `Action.shortcut`, but nothing reads it.** The field specifies `aria-keyshortcuts` syntax (`src/components/actions/action-registry.ts:74`). Only `document.details` sets it, to `"Meta+I Control+I"`. Palette rows (`quick-search.tsx`, approximately lines 245–258) show icons and labels but no shortcuts; context menus also omit them. Readers can discover `⌘I` only by hovering over Details and reading its tooltip.

**Forms have no keyboard save or cancel.** Editing (`src/components/knowledge/document-editor.tsx`) and creation (`src/components/knowledge/new-document-form.tsx`) use `onSubmit` with Save/Cancel buttons. Creation Cancel uses native `window.confirm("Discard this draft?")` when content is present (`new-document-form.tsx:81`, only `variant="empty"`).

**`canSearch` means document read capability.** `src/server/workspace-admin.ts:47` defines `canSearch: has("document.read")`. This permits attaching shortcuts inside QuickSearch (§3).

## 2. Scope

Five shortcuts, displayed in palette rows and button tooltips.

| Key | Action | Applies where |
| --- | --- | --- |
| `C` | Create document (`create.document`) | Any page where the registry offers `create.document` |
| `E` | Edit document (`document.edit`) | The document being read, when the registry offers `document.edit` |
| `/` | Open the same palette as `⌘K` | Any page |
| `⌘Enter` / `Ctrl Enter` | Save | Edit and create forms |
| `Esc` | Cancel when content is unchanged | The same forms |

**Out of scope**, explicitly recorded so these are not mistaken for omissions:

- A `?` shortcut reference dialog. Palette rows already show shortcuts; five keys do not require another table.
- Two-key navigation sequences starting with `G` (`G K`, `G S`, etc.). They require sequence timing and state; defer until single keys are insufficient.
- Applying `E` to the keyboard-focused row. It applies only to the document being read (§3.2).

## 3. Global single keys: `C`, `E`, `/`

### 3.1 Listener placement

Extend QuickSearch's existing `keydown` listener rather than adding a component or hook.

QuickSearch already has the three required pieces: available actions from `actionsFor("palette", …)` including the open document target, `useActionRunner`, and the `⌘K` window listener. A separate layer would recompute available actions or require a shared hook, both heavier than another branch.

QuickSearch is enabled only when `confirmed && canSearch` (`quick-search.tsx:55`). `canSearch` is `document.read`: callers without read access cannot create or edit, so this gate removes no capability. When `confirmed` is false, the registry already excludes mutating actions; the rules agree.

### 3.2 Binding rules

- Set `shortcut: "C"` on `create.document` and `shortcut: "E"` on `document.edit`.
- On `C` or `E`, find the matching shortcut among available palette actions and run it through `useActionRunner`. If absent, do nothing and do not call `preventDefault`.
- **The registry completely determines `E` availability.** `document.edit` requires all three axes: `canWrite && confirmed`, `HUB_MANAGED`, and `ACTIVE` current content (`action-registry.ts`, `document.edit`). Do not duplicate these checks in the shortcut. `E` therefore does nothing on `SOURCE_MANAGED`, archived, or historical content.
- **`E` applies only to the document being read**, the palette target: `topbar.target` when `topbar.pathname === pathname`. Outside a document page there is no target, no `document.edit`, and no effect.
- `/` opens the palette and calls `preventDefault` so the character is not inserted into its newly focused input.
- Existing `⌘K` and `⌘I` behavior remains unchanged.

**This is still not authorization.** The registry determines visibility and triggering. `C` and `E` merely navigate to `/knowledge/new` and `/edit`; application services re-verify writes exactly as for buttons.

### 3.3 Trigger conditions

Single-key shortcuts trigger only when **all** conditions hold. Extract the pure predicate `isSingleKeyShortcut(event)` into `src/lib/shortcut-keys.ts`; §6 explains why.

1. No `⌘`, `Ctrl`, or `Alt` modifier.
2. **No IME composition** (`event.isComposing`). Letters and `/` entered during Chinese phonetic or Pinyin composition must not become shortcuts.
3. The target is outside editable elements: `input`, `textarea`, `select`, or `contenteditable`, excluding `contenteditable="false"`.
4. The target is outside dialogs and menus: `[role="dialog"]`, `[role="menu"]`, `[role="listbox"]`. The palette itself is a dialog, so opening it suppresses single-key shortcuts.
5. No key-repeat event (`event.repeat`).
6. Letters have no Shift modifier; `/` may use Shift.

Match lowercase `event.key`, not `event.code`, so the character the user sees also works on non-QWERTY layouts. `/` allows Shift because layouts such as German require Shift+7; `event.key` remains `"/"`.

## 4. Displaying shortcuts

### 4.1 Palette

Rows with `shortcut` display keys on the right: Create document shows `C`, Edit document `E`, and Open details `⌘I`.

Derive display text from the field: take its first space-separated alternative, replace `Meta` with `⌘` and `Control` with `Ctrl`, and remove `+`. `"Meta+I Control+I"` becomes `⌘I`; `"E"` becomes `E`. Keep existing interface notation (`⌘K`, `⌘/Ctrl I`) without platform detection. Place this formatter beside the predicate from §3.3.

`shortcut` is thus the single source for binding, `aria-keyshortcuts`, and visible labels.

### 4.2 `Kbd` primitive

Add `src/components/ui/kbd.tsx`. Use it for palette rows and the top-bar search button's existing `⌘K`.

Use radius `sm` per contract §5 for inline chrome (`kbd`, inline code, badges). The existing `⌘K` uses `rounded-md` (`quick-search.tsx:193`), a contract deviation fixed here.

### 4.3 Button tooltips and `aria-keyshortcuts`

| Button | Location | `title` | `aria-keyshortcuts` |
| --- | --- | --- | --- |
| Edit | `document-header.tsx` | `Edit (E)` | `E` |
| `+` (Create document) | `source-sidebar.tsx:115` | `Create document (C)` | `C` |
| Quick search | `quick-search.tsx` | `Quick search (⌘K or /)` | `Meta+K Control+K /` |

### 4.4 No shortcut labels in context menus

A context menu targets the clicked row, while `E` targets the document being read. Showing `E` beside every row's Edit document would be wrong except on the open document's row: pressing it from another row would edit a different document. Other context-menu actions (new tab, copy link, favorite) have no shortcuts, so no hints appear.

If `E` later targets the focused row, context-menu hints can be added then.

## 5. Forms: `⌘Enter` and `Esc`

> 2026-09-28: both forms were merged into the document composer. Since 2026-09-29, rendered editing is the default and `⌘/Ctrl /` toggles Markdown source, replacing the previous `⌘⇧P` preview. See `2026-09-28-document-composer-design.md` §11.6 for current rules; this section preserves the original decision.

### 5.1 Listener placement

Edit and create forms share `src/components/knowledge/use-form-keys.ts`, returning an `onKeyDown` handler on `<form>`. It applies only with focus inside the form and attaches no global listener, avoiding palette/menu conflicts. The palette is portaled outside the form, so events do not bubble into it.

### 5.2 `⌘Enter` / `Ctrl Enter`: save

- Works in both title and body fields.
- Find `button[type="submit"]` and call `form.requestSubmit(button)` **only when that button is enabled**. Without an argument, `requestSubmit()` ignores button-disabled state, so check it. This also reuses existing conditions for pre-hydration, saving, access confirmation, and empty titles rather than duplicating them.
- Do not trigger during IME composition.

### 5.3 `Esc`: cancel

- **Unchanged content**: act like Cancel.
- **Changed content**: do nothing. Leaving requires the Cancel button, so `Esc` never discards drafts.
- Do not trigger during IME composition; Chinese IMEs use `Esc` to cancel composition.
- Do not trigger while saving, when Cancel is also disabled.

Definition of changed content:

| Form | Changed condition |
| --- | --- |
| Edit document | `title !== initialTitle` or `markdown !== initialMarkdown` |
| Create document | Nonempty `title` or `markdown`, matching existing Cancel logic |

“Act like Cancel” uses each form's existing behavior: edit returns to the document; create with `variant="empty"` returns to Knowledge, while other variants collapse the form. Unchanged creation content does not invoke its native confirmation anyway.

**Considered and rejected:** pressing `Esc` twice to discard changed content. This requires an “already pressed” state, a hint, and a reset-on-typing rule merely to save one Cancel click; an accidental double press could still discard the draft. Never discarding drafts on `Esc` is simpler and safer. Creation Cancel's native `confirm` remains unchanged: Cancel is still the sole discard entry point, and its confirmation is unaffected.

### 5.4 Button tooltips

Save and Create document use `title="Save (⌘Enter)"` and `"Create document (⌘Enter)"`; Cancel uses `title="Cancel (Esc)"`.

## 6. Tests

### 6.1 Unit

`src/lib/shortcut-keys.ts` contains pure functions tested with event-shaped objects, without a DOM. These conditions are prone to silent errors, so test directly rather than relying only on incidental E2E coverage.

- `isSingleKeyShortcut`: at least one negative case for each condition (`metaKey`, `ctrlKey`, `altKey`, `isComposing`, `input`/`textarea`/`select`/`contenteditable` targets, targets in `[role="dialog"]`, `repeat`, Shift with a letter), and positive cases for `c`, `e`, `/`, Shift with `/`. Use `closest()` for target checks and minimal fake objects implementing it.
- Display formatting: `"E"` → `E`, `"Meta+I Control+I"` → `⌘I`, `"Meta+K Control+K /"` → `⌘K`.
- Registry: `create.document` has `shortcut: "C"`; `document.edit` has `shortcut: "E"`; `SOURCE_MANAGED`, `ARCHIVED`, and `HISTORICAL` targets offer no action with `E`.

### 6.2 E2E

Add `tests/e2e/keyboard-shortcuts.spec.ts`:

- Press `C` on Knowledge and navigate to `/knowledge/new`.
- Type `c` in the tree filter; URL stays unchanged and the input contains `c`.
- Press `E` on a `HUB_MANAGED` document and navigate to `/edit`; on `SOURCE_MANAGED`, URL stays unchanged.
- Press `/`: palette opens with an empty query, `/` was not inserted, and Create document displays `C`.
- Edit: change title, press `⌘Enter`, return to the document with the new title.
- Edit: press `Esc` with unchanged content and return to the document.
- Edit: press `Esc` after changes and stay on `/edit` with content intact.

Playwright cannot reliably simulate IME composition; cover it with §6.1's negative `isComposing` case.

## 7. Contract amendments

Add a paragraph to §10 (Focus and keyboard) recording:

- Single-key trigger conditions (§3.3), checked centrally by `isSingleKeyShortcut`.
- `Action.shortcut` as the single source for binding, `aria-keyshortcuts`, and display; add shortcuts through that field.
- Why context menus omit shortcut hints (§4.4).
- Form `Esc` never discards drafts (§5.3).

No §5 amendment is needed: `kbd` already requires `sm`; this aligns implementation.

## 8. Affected files

```text
Add     src/lib/shortcut-keys.ts
Add     src/components/ui/kbd.tsx
Add     src/components/knowledge/use-form-keys.ts
Add     tests/unit/shortcut-keys.test.ts
Add     tests/e2e/keyboard-shortcuts.spec.ts
Modify  src/components/actions/action-registry.ts      C/E shortcuts
Modify  src/components/search/quick-search.tsx         /, C, E bindings; row Kbd; button tooltip
Modify  src/components/knowledge/document-header.tsx   Edit title and aria-keyshortcuts
Modify  src/components/knowledge/source-sidebar.tsx    + title and aria-keyshortcuts
Modify  src/components/knowledge/document-editor.tsx   use-form-keys; button tooltips
Modify  src/components/knowledge/new-document-form.tsx use-form-keys; button tooltips
Modify  tests/unit/action-registry.test.ts              shortcut assertions
Modify  docs/superpowers/specs/frontend-design-language.md  §10
```

## 9. Findings during implementation

The `E` E2E flow (enter edit with `E`, change title, save) failed: save succeeded but the document showed its old title until refresh. Two probes isolated the cause: client navigation into edit followed by clicking Save also failed; full-page navigation into edit followed by `⌘Enter` passed. The defect was client navigation into edit, not `⌘Enter`: the document remained in router cache and post-save push used its stale copy.

This was an **existing defect**. Palette and context-menu Edit document had used `router.push` since #47/#50; prior tests entered through the header's plain `<a>`, triggering a full load and missing this path.

The initial workaround made `document.edit` use full-page loading (`{ kind: "load" }`). Later investigation fixed the root cause and removed the workaround:

- **Cause.** The sidebar `<Link>` to the **currently open document itself** prefetched it. Self-prefetch returns a full page, with no loading boundary to split it. Next 15 uses prefetched content on its **first consumption**, regardless of age (`navigate-reducer`: stale triggers lazy fetch only after first consumption). Post-save push was that first consumption, displaying old content.
- **Evidence.** Network logs showed no post-save document RSC request after client navigation into edit, but one navigation request (`prefetch=-`) after full loading into edit. The latter also prefetched the document from `/edit`, but prefetch from another page stops at a loading boundary and fetches remaining data on consumption. Disabling self-prefetch made the former show fresh content.
- **Fix.** Set `prefetch={false}` for the current document's tree and Favorites/Recent links. Prefetching the page already open is unnecessary.
- **Why not `router.refresh()`?** If navigation arrives before refresh finishes, Next's action queue discards refresh together with its prefetch-cache invalidation. This explains the refresh/push competition observed in #49.

**Naming update.** Rename `create.document` from “Add to Notes” to “Create document” and the creation heading to “New document”. The shortcut is `C`, which “Add to” does not suggest. Use document consistently with Edit document, Open document, and the Create document button; keep destination Notes as palette keywords (`add`, `notes`).

## 10. Later addition: `⌘\` toggles navigation (2026-09-30)

Primary navigation (the left Knowledge/Graph/Sources column) previously collapsed only through its top-bar button. `⌘\` (`Ctrl \` on other platforms) now also toggles it, defined by registry `NAV_TOGGLE_SHORTCUT`. See the Shortcuts subsection in `frontend-design-language.md` §10.

- **Why `⌘\`.** Composer uses `⌘/` for rendered/source mode and `⌘B` for bold. `⌘\` has no other binding and the editor does not consume it, so it works inside the composer too. It inserts no text, so single-key editable-target exclusions are unnecessary; `matchesShortcut` excludes only composition and repeat.
- **Open dialogs or menus retain their keys:** pressing `⌘\` with the palette open does not change the underlying page.
- **Without a sidebar** (below `lg`), it toggles the replacement Menu drawer.
- **The knowledge tree has no collapse feature**, so this shortcut cannot affect it. Adding tree collapse requires that feature first and reallocating width alongside the right inspector.
- **`aria-keyshortcuts` is `"Meta+\\ Control+\\"`**: the two literal backslashes escape a JS string; the actual key is `\`.
- Layout matching requires `event.key === "\\"`. US and Zhuyin keyboards have it; some layouts such as German require AltGr, and were not tested.
