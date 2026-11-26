# Editor: find and replace

The browser's ⌘F finds text in the rendered editor but cannot replace it, and its
highlights know nothing of the document's structure. A Notion writer presses ⌘F
inside the page, gets a bar, steps through matches and replaces them. This spec
adds that bar to the rendered editor. Nothing stored changes: a replacement is an
ordinary text edit, saved as Markdown like any other, and it is held to the
wikilink rule (CLAUDE.md, "The rendered editor must write a wikilink back as it
read it").

## Decisions

1. **Opening.** Mod-F with focus in the rendered editor opens the find bar and
   moves focus to its query. Mod-F again, with the bar open, focuses and selects the query.
   The query is pre-filled with the editor's selection when that is non-empty,
   on one line and at most 200 characters; otherwise it is left as it was. The
   key is claimed only inside the editor: reader pages, the read-only stand-in
   and the Markdown source view never reach it, so the browser's own find is
   untouched there. Mod is Command on Apple platforms and Control elsewhere.
2. **Matches and highlights.** Every match is an inline decoration
   (`kh-find-match`, `--kh-highlight`); the current one is stronger
   (`kh-find-current`, `--kh-primary` with `--kh-on-primary`). No new colour: both
   tokens exist for light and dark. Matching is case-insensitive unless "Aa" (match
   case) is pressed. The count reads "3 of 12", "No results", or "1 of 1000+"
   past the ceiling, in a polite live region. A query change chooses the first match at or after the
   editor's selection, so the bar finds what is below the caret first.
3. **Moving.** Enter / Shift-Enter in the bar, the ↓ / ↑ buttons, and Mod-G /
   Mod-Shift-G (bar open, from the editor or the bar) step to the next / previous
   match, wrapping at the ends. Stepping selects the match in the editor and scrolls it
   into view. Enter always advances; it does not first "select the current one".
   Escape in the bar closes it, removes the decorations and returns focus to the
   editor with the caret at the end of the current match. Escape in the editor
   is the editor's (it selects the block), not the bar's.
4. **Replace.** A disclosure button in the bar (and Mod-Alt-F, which opens the bar
   with the replace row shown) reveals the replace field with "Replace" and
   "Replace all". Mod-Alt-F was chosen because nothing in `notion-keys.ts`,
   `block-range.ts`, the slash list or `editable-document.tsx` binds it
   (Mod-Alt-digits do), and Mod-Shift-H is Chrome's "home" on macOS. It is matched
   by physical key (`event.code`), because Option-F types "ƒ" on a Mac. Replace
   changes the current match, then moves to the next one at or after the
   replaced text, so a replacement that contains the query cannot loop. Replace
   all is **one transaction, one undo step**; both close the history group
   around themselves so a quick edit before or after is not merged into it. Enter
   in the replace field is Replace. Neither exists when the editor is not editable.
5. **What is matched.** Per textblock (paragraph, heading, code block, table
   cell paragraph, …) over its text only; a match never spans two blocks. Any
   non-text inline node in the block (a `wiki_link` node, a hard break, an image)
   is a barrier no match crosses, and nothing inside such a node is matched or
   replaced. That covers `[[wikilinks]]` and the page mentions `@` writes, which
   are wikilink nodes; the `@` date is plain text and is matched as text. A match
   may span differently marked runs (bold, italic, link, inline code) inside one
   block; the replacement takes the marks at the match's start. Code blocks are
   searched and replaced like any text; a block drawn only as a preview (a diagram)
   counts its matches, though its source is not visible until edited.
   Link text is matched; a link's URL is not. The query is plain text, not a
   regular expression.
6. **Recomputation and ceiling.** Matches are recomputed inside the plugin's
   state on every document change and query change (one pass over the textblocks
   with a native regular expression: no debounce was needed, the cost is
   linear). The current match is kept across edits as the first match at or after
   where the old one now is. Only the first 1000 matches are kept; the count says "1000+".
7. **Surface and accessibility.** The bar is React (`find-bar.tsx`: `Button`,
   `Input`, `Tooltip`), portalled into a zero-height sticky anchor the plugin puts
   at the top of the editor host, so it stays at the top right of the document
   as it scrolls, below the page's sticky header (`top: 4.5rem`, as the share
   page's rail). It is `role="search"` with a name, each field has an
   `aria-label`, each icon button an `aria-label` and a `Tooltip` with its
   shortcut, "Aa" and the replace disclosure carry `aria-pressed` / `aria-expanded`, all
   controls take `kh-focus-ring`, and at phone width the bar wraps inside the
   column (no horizontal scroll). It is hidden in print.
8. **Read-only documents** (`SOURCE_MANAGED`) have no rendered editor, so none of
   this exists there. The read-only stand-in does not register the plugin.

## Out of scope

Regular expressions, whole-word matching, find in the reader, find across
documents (⌘K search), preserve-case replacement, and a persistent query between
documents.

## Verification

- `tests/unit/editor-find-replace.test.ts`: the plugin inside the rendered editor
  (jsdom): counts, case toggle, wrap, replace one, replace all in one undo step,
  wikilinks and `@` page mentions untouched and the saved document's links equal
  to the extractor's for the same fixtures, no match across blocks, marks, code blocks, cap.
- `tests/unit/editor-find-bar.test.tsx`: the bar's roles, names and live count.
- `tests/e2e/zz-editor-find-replace.spec.ts`: Mod-F from the editor, highlight
  and "1 of 3", Enter, Replace all saved and undone by one Mod-Z, Escape returns
  focus; Mod-F outside the editor opens nothing.
