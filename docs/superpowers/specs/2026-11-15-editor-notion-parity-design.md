# Editor: closing the Notion habits gap

The rendered editor follows Notion for the page itself
(`2026-10-28-retrieval-first-shell-design.md`). A 2026-11-15 audit drove the
editor in a browser the way a Notion user would and found twenty places where
it answers differently. This spec decides each one. It amends
`2026-10-16-inline-editing.md` and the design-language contract's "Block
controls and the `/` list" section; it does not change what is stored. Every
change still writes Markdown through the rendered editor and is held to the
wikilink rule (CLAUDE.md, "The rendered editor must write a wikilink back as it
read it").

## Out of scope, recorded

- Pasted or dropped images: the Hub stores no binaries
  (`2026-09-10-phase-0-foundation-architecture-design.md`, §208).
- Underline, colour, `>` as a toggle: Markdown has no underline or colour, and
  `>` stays a quote.
- Gutter controls showing over the text: they stay in the gutter (contract,
  "Block controls").
- `Edit code` before an existing code block becomes editable: deliberate
  (`2026-10-20-reader-measure-and-heading-scale-design.md`, §100).
- @ mentions, page width, captions, templates, databases, columns, embeds:
  deferred by the 2026-10-27 audit.
- Operations on several selected blocks at once (delete, move, turn into a
  range): deferred. This spec adds block selection for one block only.
- A "Turn into" menu on the selection toolbar: the block menu has it.
- Callout icon or colour choice: a GitHub alert has a type, nothing else.
- Page icon upload: no binary storage.

## Decisions

### Typing (input rules)

1. A mark made by an input rule (`**x**`, `*x*`, `_x_`, `` `x` ``, `~~x~~`, `~x~`) ends at
   the closing delimiter: the next character typed is unmarked.
2. `[] ` and `[ ] ` at the start of a paragraph make an unchecked to-do item;
   `[x] ` a checked one.
3. Outside code, `->` becomes `→`, `<-` becomes `←`, `(c)` becomes `©`,
   `(r)` becomes `®`, `(tm)` becomes `™`. One Backspace straight after a
   replacement restores what was typed. `--` is not replaced, so `---` still
   makes a divider.

### Keys

4. Backspace with the caret at the start of a heading turns it into a paragraph
   (one press; a second press then joins as before).
5. `Mod-Shift-s`: strikethrough. `Mod-Shift-7` numbered list, `Mod-Shift-8`
   bulleted list, `Mod-Shift-9` to-do list (toggles off when already that list).
6. `Mod-Shift-ArrowUp/ArrowDown` moves the current block, `Mod-d` duplicates it,
   through the same commands as the block menu.
7. Escape in the text, with no menu open, selects the current top-level block
   (a node selection, drawn with `kh-bg-selected`). Escape again returns to the
   text; Backspace/Delete removes the block; typing replaces it; the arrows
   leave the selection as ProseMirror does.
8. `Mod-a` first selects the current textblock's text; a second `Mod-a`
   selects the whole document. In an empty block the first press selects all.
9. `Mod-k` with a non-empty text selection opens the selection toolbar's link
   field, and the command palette does not open. With no selection it is the
   palette, as now.

### Title

10. Enter in the title moves the caret to the start of the document's first
    block (creating an empty paragraph when the document is empty), and never
    inserts a line break into the title. ArrowDown on the title's last line does
    the same.

### Links

11. With the caret in a link, or on click, a small card under the link shows its
    address with Open, Edit and Remove; Edit opens the toolbar's link field.
    `Mod`-click opens the link in a new tab. A wikilink keeps its own behaviour.
12. Pasting a single URL over a non-empty selection links the selection instead
    of replacing it. Pasting a URL with no selection is unchanged.

### Selection toolbar

13. Adds Strikethrough, Inline code and Heading 3, in that order after Italic
    and Heading 2. Same button shape as the others.

### Block controls and the `/` list

14. At the default layout (a 1440px window, both sidebars open) and at every
    wider one, the gutter controls never cover text. The text's left edge stays
    the same in reading and editing. Below that, the existing fallback stays.
15. `+` inserts an empty paragraph below and opens the `/` list on it.

    **Deviation (2026-11-15, final review).** The first build opened the list
    on an empty line with nothing typed, so a word typed next was a hidden
    query: `Title`, `Note` or `A` with Enter or Tab converted the block and
    dropped the word. `+` now writes a visible `/` on the new line, as Notion's
    does, and the list opens through the same path a typed `/` takes: what is
    typed next is that `/`'s query, in sight, and behaves exactly as a typed
    `/query` does. Dismissing the list (Escape, leaving the editor, moving the
    caret off the line) while the `/` is still alone on the line takes the `/`
    back, leaving the empty line with the caret in it; anything typed after the
    `/` stays. A `/` typed by hand is never taken back.
16. The `/` list matches aliases as well as labels: `h1`, `h2`, `h3`, `p`,
    `todo`, `checkbox`, `ul`, `bullet`, `ol`, `number`, `hr`, `line`, `quote`,
    `code`, `table`, `toggle`, `callout`. Each row has a 16px lucide icon at its
    left, in muted text.

### Blocks

17. Toggle: the chevron sits on the summary's line, at its left. Inserting a
    toggle puts the caret in the summary; Enter at the end of the summary goes
    to the first line of the body (opening it when it is closed).
18. Table: Tab in the last cell adds a row and moves into its first cell.
19. Code block while editing: a language field (a native `<select>` of the
    languages the highlighter knows, plus "Plain text") sits in the block's
    header; Tab inserts two spaces and Shift-Tab removes up to two at the line's
    start.
20. Callout: its label is a button that opens a menu of the five GitHub alert
    types (Note, Tip, Important, Warning, Caution); choosing one rewrites
    `[!TYPE]`.

### Paste

21. `<s>` and `<strike>` paste as strikethrough. A list item that starts with a
    checkbox `<input>` pastes as a to-do item with its checked state. A pasted
    table with no `<thead>` or `<th>` uses its first row as the header instead
    of gaining an empty one.

### Page icon

22. The picker gains a search field and a set of about 300 emoji with English
    and Traditional Chinese keywords, bundled as a TypeScript module (no new
    dependency). The 16 current emoji stay first as "Suggested".

## Verification

Each decision has a test that drives the rendered editor (unit, through the
editor the app mounts) or a Playwright spec where layout or focus matters.
Decisions that rewrite Markdown also save and read the document's links back
(`tests/fixtures/link-markdown.ts`).
