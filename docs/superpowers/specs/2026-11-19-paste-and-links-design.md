# Editor: Markdown paste and links as they are written

A 2026-11-17 audit drove the rendered editor in a browser, pasting and typing the
way a Notion writer does. Three habits answered differently. Pasted Markdown text
came out escaped (`\## Pasted`, `\- a`, `\*\*bold\*\*`). A web address, pasted or
typed, stayed text and was written as `https\://…`. A typed `[text](url)` was
written back escaped. This spec decides each. It amends decision 12 of
`2026-11-15-editor-notion-parity-design.md` and the design-language contract's
"Pasted HTML" section. No stored format changes: every result is Markdown the
reader already reads. Each change writes through the rendered editor and is held
to the wikilink rule (CLAUDE.md).

## Decisions

1. **Text that reads as Markdown pastes as Markdown.** This applies to a
   plain-text paste, meaning no clipboard HTML. VS Code's HTML is the one
   exception: it is only the source in colour, and its `vscode-editor-data`
   says `markdown`. Such a paste is parsed by the editor's own parser, the one
   a document is opened with. The sign of Markdown is any of:

   - a heading, list, numbered, quote, fence or table line;
   - `**bold**`, `~~strike~~` or `` `code` ``;
   - `[text](url)`.

   Text without one pastes as before, one paragraph per line, so a sentence
   such as `a - b` stays a sentence. A pasted `[[wikilink]]` becomes the node
   and keeps its edge.

   A paragraph at either end of the paste runs into the line it lands in. Any
   other block, such as a heading or a list, stays that block: it splits the
   line, or takes the place of an empty one.

   The paste is refused in a code block, in inline code, and in a table cell,
   which holds one line. There it pastes as text.

   Clipboard HTML from other apps keeps its own path (`paste-html.ts`).
2. **An address pasted at a caret is a link to itself.** This applies to a
   plain-text paste of one http(s) URL, written as `<url>`. Over a selection it
   still links the selection, as decision 12 of 2026-11-15 says. Inside inline
   code it is text. This replaces the earlier "pasting a URL with no selection
   is unchanged".
3. **A typed address becomes a link when a space follows it.** Punctuation
   right after it (`.,;:!?'")]}`) stays outside the link, as GFM's autolink
   literal does, except a `)` that closes a `(` inside the address
   (`…/Foo_(bar)`). Nothing happens in code, and nothing happens to an address
   that is already linked.
4. **A typed `[text](url)` becomes the linked text** when its closing
   parenthesis is typed. `![alt](src)` and `[[wikilinks]]` keep their own rules.

## Out of scope, recorded

- Plain text with single newlines inside Markdown follows Markdown: two lines
  without a blank between them are one paragraph.
- Notion's "paste as bookmark / embed" menu: the Hub has no embeds (deferred by
  the 2026-10-27 audit).
- Trailing spaces at the edges of a Markdown paste are trimmed by the parser.
- An address inside a pasted sentence, or typed and then followed by Enter or the
  end of the line, is not linked. It is still written `https\://…`, the defect
  the audit named. Decisions 2 and 3 cover the two commonest paths: a pasted
  address alone, and an address followed by a space. Linking addresses inside
  pasted text needs a decision about mixed text and Markdown, which is left for
  later. `editor-markdown-paste.test.ts` records the current output.
- Typing a space over a selection replaces the selection and links nothing.
  The text before the caret is not what was matched (review, 2026-11-17).

## Verification

- `tests/unit/editor-markdown-paste.test.ts` covers each decision through the
  rendered editor, including the wikilink and VS Code cases and the text that
  must stay text. Results are reopened from their saved Markdown.
- `tests/unit/editor-links-toolbar.test.ts` covers decision 2 at a caret.
- `tests/e2e/zz-paste-and-links.spec.ts` uses the real clipboard: Markdown
  pastes as blocks, an address pastes as a link, and a typed address becomes
  a link, all surviving save and export.
