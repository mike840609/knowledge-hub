# Editor: keys and caret (Notion parity, third group)

The 2026-11-19 edit-mode audit found seven places where the caret or a key goes
somewhere a Notion writer does not expect. This spec decides each one. It amends
`2026-11-15-editor-notion-parity-design.md` (decision 5's shortcut list and the
code block's Tab rule, decision 19) and the design-language contract's "Block
controls and the `/` list" and code-block passages. Nothing stored changes:
every key writes Markdown through the rendered editor and is held to the
wikilink rule (CLAUDE.md).

## Decisions

1. **A press below the text writes at its end.** An editable document keeps
   30vh of room under its column (`.kh-reading-column[data-press-below]`). A
   primary press on the column itself, below the editor's last line, puts the
   caret at the end through `MarkdownEditor.focusEnd()`. That call adds an
   empty paragraph unless the document already ends in one, so a press below a
   list, table, code block or toggle starts a new line, not more of that block.
   Before, the press focused the document region, and typing went nowhere.
2. **Tab stays in the text.** Tab and Shift-Tab with a text caret outside a
   list, a table and code are claimed and write nothing; before, they moved
   focus to the next control on the page and the writer's next keys followed
   it. Lists, tables and code keep their own Tab. A block chosen with Escape
   (decision 7 of the 2026-11-15 spec) is not a text caret, so Tab goes on to
   the page from there. Escape then Tab is the documented way out, and the
   editor is no keyboard trap (WCAG 2.1.2). This replaces "Tab is bound nowhere
   else outside a table's last cell" in the contract.
3. **The top of the document leads to the title.** ArrowUp on the first line of
   the first textblock, and Backspace in an empty first paragraph, fire a
   cancelable `kh:editor-exit-top` on the editor (`EXIT_TOP`). The document page
   claims it while it has a Title field, and puts the caret at the field's end.
   Backspace also removes that empty paragraph when other blocks follow it.
   Unclaimed, as in a document titled by its opening H1, the keys do what they
   did before. This is the way back from the title's Enter and ArrowDown
   (`leaveTitle`).
4. **`Mod-Enter` in a to-do ticks it**, or unticks it. Everywhere else
   `Mod-Enter` still saves. In a to-do it saves too, because the page's capture
   handler flushes before the editor ticks, so the tick is the next autosave.
   The capture handler no longer calls `preventDefault` there, since a
   prevented key never reaches ProseMirror.
5. **Notion's `Mod-Alt` digits.** `Mod-Alt-4` to-do, `-5` bulleted list, `-6`
   numbered list, `-7` toggle, `-8` code block, all at keymap priority 70 over
   Milkdown's. `0`–`3` stay Milkdown's (text, H1–H3). Heading 4–6 lose their
   key: the `/` list and the block menu offer no H4–H6 either. The lists
   toggle as `Mod-Shift-7`/`-8` do; toggle and code turn the block as the block
   menu does.
6. **Backspace at the start of a top-level list's first item** makes it a
   paragraph before the list, and the other items stay a list. Milkdown's own
   Backspace joined the item into the block above the list. An item with nested
   items keeps `liftListItemOverNested`'s rule.
7. **`/` after a space mid-line opens the list.** Text before the caret in a
   top-level paragraph, ending in whitespace, `/`, and up to 40 characters with
   no space, `/` or `:`, opens the list at that `/`. Choosing a block takes
   `/query` out of the line and adds the block below it, caret inside. Page
   link writes `[[` in place, which opens the `[[` list. A query nothing
   matches does not open the list, so a path typed as text (` /usr`) stays
   quiet. A `/` straight after a letter (`and/or`) never opens it. The whole-line
   `/` keeps its rule, and Escape dismisses either one until a new `/` is typed.

## Verification

`tests/unit/editor-keys-caret.test.ts` drives each decision through the
rendered editor. `tests/e2e/zz-editor-keys-caret.spec.ts` drives decisions 1,
2, 3, 4, 5 and 7 in a browser and reads the saved Markdown back through export.
Two unit tests that stated the old Tab rule now state decision 2:
`editor-notion-blocks.test.ts` and `wikilink-suggest.test.ts`.
