# The reader's look, hinted in the editor

## Intent and agreed product direction

The reader draws `> [!NOTE]` as a callout
(`2026-10-12-reader-callouts-design.md`) and seven HTML tags as what they mean
(`2026-10-12-reader-html-subset-design.md`). The rendered editor showed both as
plain text, so a writer could not see what a reader would.

Agreed with the user on 2026-10-12: **style only, and keep the marks.** The
editor shows the reader's look as a hint; `[!NOTE]` and the tags stay in the
text, visible and editable. The alternative — editor nodes that hide the marks
and look exactly like the reader — means a schema, a parser, a serialiser and
an input model for each, and puts the saved Markdown at risk. It was not taken.

## What is hinted

| Written | In the editor |
| --- | --- |
| A quote whose first line is `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` | The quote's line takes the kind's colour and its text is no longer muted. The marker line stays. There is no title row and no glyph: the marker is the title here. |
| `<u>…</u>`, `<sub>`, `<sup>`, `<kbd>`, `<mark>` within one block of text | What is between the tags is drawn as the reader draws it. The two tags stay, set smaller and muted, as tags. |

What counts is decided by the reader's own rules — the marker by `calloutKind`,
the tags by `INLINE_HTML_TAG` and the same nearest-opening pairing — so the
editor does not hint at something the reader will not draw. An unknown kind,
text after the marker, an unpaired tag, a tag with an attribute: no hint.

`<details>` is not hinted. Its tags are blocks of HTML between blocks of
Markdown, and folding content away while it is being written helps nobody.

## How

One ProseMirror plugin, `src/components/knowledge/editor/reader-hints.ts`, that
computes decorations from the document and recomputes them when it changes:

- a node decoration on the quote, carrying `data-callout="<kind>"`;
- an inline decoration between a pair of tags, whose `nodeName` is the tag's;
- a node decoration on each tag of a pair, with the class `kh-html-tag`.

The styles are rules on `.kh-editor` in `globals.css`, using the reader's
tokens.

**Decorations are not in the document.** The plugin has no schema, no parse
rule and no serialise rule. The Markdown the editor writes is, byte for byte,
what it wrote without it; the clipboard, which serialises through the schema,
carries none of it. The rule that the rendered editor must write a wikilink
back as it read it (`CLAUDE.md`) is not in play, and the tests hold that the
written Markdown is unchanged.

## Known difference

The composer's stand-in while the editor loads (`MarkdownBase`) shows a plain
quote and tag text; the editor then shows the hints. The difference is a line's
colour and an underline arriving with the editor. Giving the stand-in the hints
would mean a second implementation of them for the server; not done.

## Tests

`tests/unit/editor-reader-hints.test.ts`, through the real editor: each kind of
callout and each tag; the spellings of the marker, the escaped one the editor
writes included; what must get no hint; that the marker and the tags are still
in the text; that the hints follow typing in both directions; and that a
callout, the HTML subset and a `<details>` are written as they were before.
