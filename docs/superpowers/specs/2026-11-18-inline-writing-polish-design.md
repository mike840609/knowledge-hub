# Inline writing polish: emoji, clear formatting, copy link

A third pass over the rendered editor, after the 2026-11-15 parity work and the
2026-11-17 block work, found three Notion inline-writing habits still missing
and not among the items those passes deliberately deferred. This spec decides
each and amends `frontend-design-language.md`. It changes no stored format: an
emoji is text and clearing marks only removes them.

## Decisions

1. **`:shortcode` offers emoji.** Typing `:` after the start of a word (a
   space, an opening bracket or the start of a line) and at least two letters
   opens a list of the bundled emoji (`lib/emoji-catalog.ts`), best match first:
   an exact shortcode or keyword, then a prefix, then a substring. The name's
   slug is the shortcode (`grinning face` → `grinning_face`); keywords are
   English and Traditional Chinese. Enter, Tab or a click inserts the glyph;
   ArrowUp/Down move; Escape closes without changing the text. A fully typed
   `:shortcode:` converts on the space after it. The list never opens in code
   (a code block or inline code), or after a word character (`http://`,
   `12:30`). One undo step.
2. **Clear formatting.** The selection toolbar adds **Clear formatting** (the
   `Tx` glyph), and `Mod-\` runs the same action: every inline mark comes off
   the selection; at a caret it drops the mark the next character would carry.
   It does not change the block type (a heading stays a heading), which is
   Notion's `Cmd+\` behaviour.
3. **Copy link.** The link card's first action is **Copy**, which copies the
   address it shows to the clipboard (the written `href`, not a resolved
   absolute URL) and says **Copied** for a moment. A refused clipboard leaves
   the card as it was.

## Out of scope, recorded

- Underline, text colour and highlight: Markdown has no marks for them.
- Clear formatting that also turns a heading/list/quote back into a paragraph:
  `Mod-\` is inline-only; the block menu's Turn into → Text does the block.
- @ mentions, page width, images, columns, embeds, real-time collaboration and
  the rest of the earlier deferred list.
- Team-document comments (still an authorization change; the previous pass
  recorded it).

## Verification

- `tests/unit/emoji-shortcodes.test.ts` (the index and its ranking),
  `tests/unit/editor-emoji-suggest.test.ts` (open, arrows, Enter, Escape, the
  space conversion, and no trigger in code or after a word character),
  `tests/unit/selection-toolbar.test.ts` (Clear formatting by button and key,
  the caret case, and Copy link).
- `tests/e2e/zz-inline-writing-polish.spec.ts`: an emoji chosen from the list
  and a cleared selection survive save and export.
- `npm run typecheck`, `npm run lint`, `npm run test:unit`.
