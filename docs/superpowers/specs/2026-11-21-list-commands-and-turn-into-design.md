# Editor: `/`, `+` and Turn into work the same inside a list (Notion parity)

A 2026-11-21 desktop audit (1440 × 900, `b66a360a`) found two places where a
list item answers differently from a paragraph.

1. **`/` and `+` do less in a list item.**
   - Typing `/quo` in an item leaves the text as typed. The `/` list opens
     only in a top-level paragraph: `detect` in `slash-commands.ts` requires
     depth 1.
   - The grip's `+` on an item inserts an empty item and opens nothing. On a
     paragraph it opens the `/` list (2026-11-15 decision 15).
2. **The same conversion is refused in one place and done in another.**
   - With text selected in a bulleted item, the selection toolbar's "Numbered
     list" button is disabled. Wrapping the item's first paragraph would put a
     list first inside the item, which the schema refuses.
   - The grip's Turn into → Numbered list turns the same item, by 2026-11-17
     decision 2.

In Notion, `/` works in any block. In an empty block, a choice turns that
block. The selection toolbar's first control is a "Turn into" menu that names
the block's current kind. This spec adopts both. It amends:

- decision 15 of `2026-11-15-editor-notion-parity-design.md`, and its "Out of
  scope" entry "A 'Turn into' menu on the selection toolbar";
- decision 13 of the same spec;
- the design-language contract's "Block controls and the `/` list" and "The
  selection toolbar and the link card" sections.

It depends on `2026-11-21-block-unit-design.md`: several blocks turned in one
undo step, and a list item as the unit. It lands after that spec.

Nothing stored changes.

## Approaches

- **One turn path, reached from everywhere (chosen).** The `/` list in an
  item, the item's `+`, the toolbar's Turn into, the grip menu and the turn
  keys all end in `turnBlockInto`. So the same choice gives the same result
  wherever it is made. That is Notion's model, and it removes the reason a
  button is ever disabled when another entry would succeed.
- **Keep the toolbar's buttons, and route the list buttons through
  `turnBlockInto`.** This fixes the disabled button. It keeps six buttons
  (H1–H3, two lists, Toggle) on a toolbar that also holds marks and Link, and
  still leaves quote, code and callout reachable only from the grip. Rejected
  for the toolbar. The routing itself is part of the chosen approach.
- **`/` in an item always inserts a new block below.** This is simpler, but
  it differs from Notion and from a top-level empty line, where the choice
  replaces the line. Rejected.

## Decisions

### `/` in a list item

1. **`/` in a list item opens the `/` list as it does in a paragraph.** It
   applies in the item's first paragraph, under the same two triggers:
   - `/` alone on the line, where the item has no other text;
   - `/` after a space mid-line, when a command matches what follows.

   Inline code and link text still keep a `/` as text.
2. **A choice made with `/query` alone in the item turns the item.** It uses
   the turn rules of 2026-11-17 decision 2:
   - the item's own list kind keeps the item;
   - another list kind moves it into a list of its own;
   - Text, a heading, Quote, Code, Diagram, Toggle or Callout replaces the
     item and splits its list around the result;
   - Divider and Table do the same with an empty divider or a 2×2 table.

   The `/query` is removed either way. Today's date and Page link write
   inline where the `/` was, as they do in a paragraph.
3. **A choice made after text goes below the item, at its level.** The `/query`
   is taken out of the line.
   - A list kind the same as the item's adds an item after it.
   - Any other block splits the list after the item and stands between the
     two parts.
   - An ordered list that goes on after the block keeps its numbers
     (2026-11-17).
   - For a nested item, the block becomes a child of the parent item, which
     Markdown allows. That is where Notion puts a child block.
4. **`+` on an item adds an empty item below and opens the `/` list on it.**
   It does this the way `+` does at the top level: it writes a visible `/`
   (2026-11-15 decision 15, deviation). A choice turns the new item by
   decision 2. Dismissing the list while the `/` is still alone takes the `/`
   back and leaves the empty item, which is what Enter would have made. Enter
   is unchanged.

### Turn into on the selection toolbar

5. **The toolbar's block buttons become one Turn into button.** It replaces
   Heading 1–3, Bulleted list, Numbered list and Toggle.
   - It sits first on the toolbar. It is a `ghost` `sm` button whose label is
     the current kind ("Text", "Heading 2", "Bulleted list", …, or "Mixed"
     when the selection covers blocks of several kinds), followed by a
     chevron.
   - It opens the block menu's Turn into list: same entries, order and icons,
     with the current kind checked.
   - An entry is disabled only when `canTurnInto` refuses it for a block the
     selection touches.
   - The marks, Link and Clear formatting stay, in their order, after a
     separator.
6. **It acts on the blocks the text selection touches.** It uses the
   block-unit spec's definition, so a selection inside one list item turns
   that item, not its list. Several blocks turn in one undo step. Afterwards
   the same text stays selected, so a mark can follow.
7. **Every entry point gives the same result.** The toolbar, the grip menu,
   the `/` list and the turn keys call the same function for the same blocks.
   A test turns the same item through each and compares the saved Markdown.

## Out of scope, recorded

- **Colour and "Turn into page."** Markdown has no colour, and a page is a
  document, not a block.
- **A filterable Turn into (typing to narrow it).** It has ten entries. The
  `/` list already filters.
- **`/` inside a table cell, a code block or a toggle's summary.** A cell or a
  summary holds inline text only, and a code block's `/` is code.

## Verification

- `tests/unit/editor-slash-commands.test.ts`, through the rendered editor:
  - `/quo` alone in an item gives a quote between the list's two halves.
  - `/num` in a bulleted item moves it into a numbered list.
  - `/date` writes inline.
  - A mid-line `/code` after an item's text splits the list after it.
  - A nested item's block becomes a child of the parent item.
  - Every result is read from the saved Markdown, and the wikilink round-trip
    holds for an item holding a `[[link]]`.
- `tests/unit/editor-block-gutter.test.ts`: `+` on an item writes `/`, and
  dismissing takes it back and leaves an empty item.
- `tests/unit/selection-toolbar.test.ts`:
  - The Turn into label for a paragraph, a heading, an item and a mixed
    selection.
  - Numbered list enabled in a bulleted item.
  - Several blocks turned with one `Mod-z` back.
  - Toolbar, grip, `/` and keys give the same Markdown for the same item.
- `tests/e2e/zz-list-commands.spec.ts`:
  - The audit's three cases (`+` on an item, `/quo` in an item, Numbered list
    from the toolbar in a bulleted item), read from the saved Markdown.
- `make verify`.
