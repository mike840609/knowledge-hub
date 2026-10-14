# Toggle disclosures backed by the details pipeline

## Intent and agreed product direction

Long documents need collapsible sections, Notion-toggle style. The
repository already parses, renders, round-trips, and reviews inside
`<details>/<summary>` (reader-html-subset, MarkdownDetails, the editor's
verbatim round-trip case, review anchors inside the body). What is missing
is entirely on the editor side: there is no way to create a toggle except
hand-writing HTML, and no way to open or close one without leaving the
rendered editor.

Agreed direction ( standing goal 2026-10-14: proceed on recommendations,
PR review is the final gate):

- **Reuse the details pipeline; no new node, no new syntax.** Stored
  Markdown stays plain text any editor can read.
- **Single level first.** One summary line plus arbitrary blocks. Nested
  `<details>` is preserved verbatim by the parser but gets no creation UI
  and no interaction guarantee.
- **No `>` shortcut.** `>` already opens quotes and callouts
  (`> [!NOTE]`); stealing a key would break existing documents. Creation
  goes through the selection toolbar.

Success means: an owner turns a paragraph into a toggle from the toolbar,
types into its body, folds and unfolds it in the editor, saves, reloads to
the same open state, and reads it folded on the shared page.

## Behaviour

**Stored shape.** Exactly what the subset parser already accepts:

```markdown
<details>
<summary>Title</summary>

body blocks

</details>
```

The `open` attribute records the open state (`<details open>`, written back
verbatim like today). Summary is one text line; hostile shapes (attributes,
tags in the summary, missing close) keep today's verbatim-text fallback —
this spec adds no new parser branches.

**Creating.** The selection toolbar gains a "Toggle" button (after the list
buttons). With a collapsed caret or a text selection inside a paragraph or
heading, it replaces the block with a details whose summary is the block's
text and whose body starts empty, then puts the caret at the start of the
body. One undo step. Outside a convertible block the button is disabled
(same pattern as the list buttons' `disabled`). No slash menu, no turn-into,
no multi-block wrapping in this cut.

**Opening and closing in the editor.** The editor renders html nodes as escaped
tag text, so a disclosure has no clickable element there (verified by DOM
inspection; a real node view would be a custom-syntax project of its own and
is out of scope). Folding affordance in the editor is the keyboard:
`Alt+Enter` flips the disclosure at the caret. Flipping persists by writing
the `open` attribute into the stored Markdown through the normal emission
path (a flip is a document change like any other). `Cmd/Ctrl+Enter` keeps
meaning Save everywhere — it is the composer-wide contract and a caret
inside a toggle does not override it. Visual folding stays a reader
capability (native disclosure), which is where long-document folding pays.

**Reader.** No change. Native disclosure, keyboard owned by the browser,
print-safe, `open` honoured. Review focus keeps opening ancestor disclosures
as it does today.

**Outline.** Headings inside a folded body are still listed (the outline
reads the rendered article). Jumping to one first opens its ancestor
disclosures, reusing the `closest("details").open = true` pattern from
`review-highlights.ts`, then scrolls as today.

**Review.** No change. Selections inside a toggle body keep resolving to
canonical blocks with paths, per the existing details cases.

## Error handling

A disclosure the editor cannot parse stays editable source text (today's
`EditorParseError` path is untouched). `Alt+Enter` outside any disclosure
does nothing. A `?thread=`-style deep link is unaffected.

## Testing

- Unit: toolbar conversion as a pure function (paragraph/heading in,
  details Markdown out; disabled states); `open`-attribute flip on the
  Markdown text; extended details round-trip cases beside the existing one.
- Rendered-editor tests (the wikilink-spec pattern): create a toggle
  through the UI, save, reopen, assert the edges survive — through the
  rendered editor, never the source view.
- E2E: create, fold/unfold, reload persistence, reader folding on a shared
  page, outline jump into a folded body.

## Non-goals (YAGNI)

Nested toggles, turn-into conversion, drag-and-drop of disclosures, slash
commands, toggle inside table cells or callouts, open-state sync across
devices beyond the stored attribute, any new Markdown syntax, any parser
change.
