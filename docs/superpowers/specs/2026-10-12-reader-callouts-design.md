# Callouts in the reader

## Intent and agreed product direction

Generated and imported Markdown marks a note, a warning and the like the way
GitHub does: a quote whose first line is `[!NOTE]`. The reader showed that as a
quote that begins with the text `[!NOTE]`. It now shows a callout.

Agreed with the user on 2026-10-12: GitHub's five kinds and nothing more; drawn
as the quote's line plus a coloured glyph, with no new colour tokens.

Success means a document that holds `> [!WARNING]` reads as a warning in the
reader and on a shared page, before and after it has been opened and saved in
the editor, and that nothing else about the document changes.

## What is a callout

A quote is a callout when the first line of its first paragraph is the marker
and nothing else:

```text
> [!NOTE]
> Body, in any Markdown a quote can hold.
```

- The kinds are `NOTE`, `TIP`, `IMPORTANT`, `WARNING` and `CAUTION`, in any case.
- Spaces after the marker, a hard break after it, and a blank quote line between
  it and the body are all the same callout.
- A marker with no body is a callout that is only its title.
- A quote inside a callout is still a quote. A callout may sit wherever a quote
  may, including inside a list item.

Left as the quote they were written as, with their text shown:

- an unknown kind (`[!FOO]`);
- text after the marker on its line (`> [!NOTE] text`), as on GitHub;
- a marker that is not the quote's first line, or is not in a quote.

**`\[!NOTE]` is the marker too.** The editor escapes a `[` that is text, so a
document saved there holds `> \[!NOTE]` (composer spec §11.8). The two spellings
parse to the same text and the reader recognises the text, so a callout
survives a save. GitHub does not read the escaped spelling as an alert; an
exported file that was saved in the editor is a plain quote there. That is the
recorded cost of §11.8, not something this change adds.

## How it is drawn

The contract is in the design language, §8 "Callouts". In short: the quote's
left line and a title row — a Lucide glyph and the kind's name in English
(`Note`, `Tip`, `Important`, `Warning`, `Caution`) — with the body in the text
colour rather than the quote's muted one. Only the line and the glyph take a
colour.

It is a `<div role="note">`, not a `<blockquote>`: nobody is being quoted. The
glyph is `aria-hidden`; the kind is said by the title, which is text.

## Where

| Surface | Callout? |
| --- | --- |
| Reader (`MarkdownRenderer`) | Yes |
| Shared page `/s/:token` (the same renderer, without link resolutions) | Yes |
| Rendered editor | No — a quote whose first line reads `[!NOTE]` |
| Composer's loading preview (`MarkdownBase`) | No — it stands in for the editor and must look like it |

The stored Markdown, export, search snippets, the outline and the link index are
untouched: this is a way of showing a document, not a change to one.

## Shape of the change

- `src/shared/markdown/remark-callouts.ts` — a remark plugin. It marks the quote
  with `data-callout="<kind>"` and removes the marker from what is shown. It
  decides what is a callout and nothing about how one looks.
- `src/components/knowledge/markdown-callout.tsx` — `MarkdownQuote`, the
  renderer's `blockquote`: a callout where the plugin marked one, a
  `<blockquote>` otherwise.
- `MarkdownBase` takes extra `remarkPlugins`; only `MarkdownRenderer` passes the
  callout plugin, which is what keeps the composer's preview a quote.

## Not in this change

- Obsidian's dialect: a title of the author's own, folding (`[!NOTE]-`), and its
  further kinds and aliases.
- A callout in the editor, and a way to insert one from it.
- Colour for `NOTE` and `IMPORTANT`. The palette has no information or emphasis
  colour, and one accent is a principle of the design language (§8).

## Tests

`tests/unit/markdown-renderer-callouts.test.tsx` holds each rule above: the five
kinds, the spellings of the marker, what is left a quote, what a callout keeps,
its role and glyph, the colour each kind takes, and that `MarkdownBase` alone
draws none.
