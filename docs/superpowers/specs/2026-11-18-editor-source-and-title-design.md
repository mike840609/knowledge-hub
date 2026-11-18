# Editor: the Markdown source surface and the title's own control

A review of the inline editor found two pieces of page chrome that read as
controls for their own sake: the Markdown source was the page with its
formatting stripped — reading-size prose floating on the canvas — and the
header carried a Rename pencil for a title that is already edited in place.
This spec decides both. No stored document changes.

## Decisions

1. **The Markdown source is a code surface, not a stripped page.** It takes the
   monospace and inset fill of a fenced code block (`font-mono`, 13/24), sits in
   a `border-strong` field at the `md` radius with 16px horizontal and 12px
   vertical padding, and keeps a 12rem minimum. It grows to its content and the
   page scrolls, as the source always has; there is no inner scrollbar and no
   native resize grip. The field is still `aria-label="Markdown"`, has
   spellcheck off, and keeps the composer's placeholder. Source remains the
   same single state (`markdown`), so drafts, titles, conflicts and saves are
   unchanged.

   One spelling, `MARKDOWN_SOURCE_FIELD`, is shared by the inline editor
   (`editable-document.tsx`) and the composer (`document-composer.tsx`), so the
   two source modes cannot drift apart. It carries no display utility: the
   composer hides its field with the `hidden` attribute, which a `block` class
   would override — leaving the source in the Tab order under the rendered
   editor (`document-composer-navigation.spec.ts` caught this).

2. **The source toggle is one of the header's icon actions.** It is the
   `FileCode2` glyph, `icon`, with `aria-label="Markdown source"`, a `Tooltip`
   that says Show Markdown source / Show the rendered editor and carries
   `⌘/`, and the pressed fill the header uses for state. On a phone it is the
   same glyph; it no longer becomes a wide text button. A disabled toggle keeps
   a native `title` saying why (the editor is still loading, or rendered
   editing failed and the source is already open).

3. **The title is its own control; there is no Rename button.** A document with
   a typed or frontmatter title already shows the title field, which is edited
   where it is read; a document whose title is its opening H1 is renamed by
   editing that heading in the article. The header's pencil repeated what a
   click on either already does, and it was the only action that stood for a
   piece of text rather than for the page. It is removed, with its
   `selectOpeningHeading` editor method. The first-use hint ("Click anywhere in
   the text to edit") still says the page is editable.

4. **The room below the text belongs to rendered editing.** The 30vh
   press-below tail is not drawn in source mode: a press below cannot place a
   caret in a textarea, so the tail would only be empty space under the code
   surface.

## Out of scope, recorded

- Syntax highlighting, line numbers, a soft-wrap switch and a split
  rendered/source view: the source is for inspecting and correcting the stored
  Markdown, not a second editor product.
- A hover row or inline hint on the title: the title's text is the control, and
  the first-use hint covers discovery.

## Verification

- `tests/e2e/zz-inline-editing.spec.ts` edits an opening H1 in the article and
  in Markdown, edits a frontmatter title through its field, and switches
  rendered/source; it no longer needs a Rename control.
- Manual at 1600 and 390: the source field is one bordered, monospaced surface,
  the header holds only icon actions, and no horizontal overflow appears. The
  same frame was captured on the base commit and on this branch, in
  `docs/superpowers/verification/2026-11-18-editor-source-and-title/`:
  `source-before-light.png` / `source-after-light.png`, the `-dark` pair, and
  the `-phone` pair.
- `npm run typecheck`, `npm run lint`, and the unit suite. `zz-inline-editing`
  and the composer's height re-fit test pass against an isolated database.
