# A subset of HTML in the reader

## Intent and agreed product direction

The reader renders no HTML: a tag in a document is shown as the text it was
written as. That is safe, and it is why generated and imported documents show
`<details>`, `<kbd>` and `<sub>` as tags. #169 taught the reader `<br>` and
comments; this teaches it seven more tags.

Agreed with the user on 2026-10-12:

- **The subset:** `<details>` with `<summary>`, and `<u>`, `<sub>`, `<sup>`,
  `<kbd>`, `<mark>` — written bare, with no attribute.
- **Everything else stays text**, as now. The reader does not parse HTML and
  strip what it disallows.

Success means those tags read as what they mean in the reader and on a shared
page, and that no document can put an element or an attribute on the page that
this list does not name.

## Why recognise, and not parse and sanitise

The usual way is a real HTML parser followed by an allow-list sanitiser
(`rehype-raw`, `rehype-sanitize`). It was weighed and not taken, for two
reasons that come from this product rather than from taste.

1. **Stripping loses what people wrote.** Markdown reads `<String>` in
   `List<String>` and `<your-token>` in a sentence as HTML. Today they are shown,
   because unknown HTML is shown as text. Under a sanitiser they are removed:
   `List<String>` becomes `List`. A knowledge base full of technical prose
   cannot lose those silently.
2. **The failure mode is the wrong one.** A sanitiser lets input through and
   subtracts; its schema would also have to admit everything the pipeline
   already emits (wikilink attributes, heading ids, callouts, footnotes, table
   alignment). A mistake in it either breaks one of those or opens a hole.
   The Content-Security-Policy would not catch the second: it is
   `img-src 'self'`, plus `frame-ancestors 'none'` on shared pages
   (`next.config.ts`), and has no `script-src`.

So the plugin recognises and constructs. It matches an `html` node against a
handful of exact patterns and, on a match, makes the element itself. No
character of the author's markup is ever emitted as markup. What does not match
is left alone, which means shown as text. The worst this can do with input it
was not written for is fail to draw it.

## What is recognised

Tag names in any case. Nothing else may vary: no attribute, no space inside the
tag, no self-closing form.

### Inline: `<u>`, `<sub>`, `<sup>`, `<kbd>`, `<mark>`

An opening tag and its closing tag among the content of one paragraph, heading,
list item's line, or table cell.

- What is between them is Markdown as usual, and may hold more of these tags.
- A closing tag takes the nearest opening tag of its name. An opening tag left
  without one, and a closing tag that finds none, stay text. An inner tag left
  unclosed is text inside the outer one that was closed.
- A pair that spans two paragraphs is not a pair. Nor is one written as blocks
  around paragraphs.
- Inside code they are code.

### Block: `<details>`

```markdown
<details>
<summary>Title</summary>

Body, in any Markdown.

</details>
```

- The opening is `<details>` or `<details open>`, optionally followed — on the
  same line, the next line, or as the next block — by `<summary>text</summary>`.
- The summary's text is plain: no tag and no Markdown. Left out or empty, it is
  `Details` — the word the browser would supply, drawn the product's way.
- The closing is `</details>` as a block of its own. Pairing is as for the
  inline tags, so one may hold another, a callout, a list, a code block.
- It sits among blocks: at the top level, in a quote, in a list item, in
  another `<details>`.

Left as text, for example:

- `<details class="x">`, `<details ontoggle="…">`, `<summary onclick="…">`;
- a summary that holds a tag (`<summary><b>x</b></summary>`);
- a `<details>` that is never closed, or written inside a line of text;
- a `<details>` written without blank lines around its body. Markdown reads the
  whole of that as one piece of HTML and does not parse the body, on GitHub as
  here.

## What is emitted

| Written | Element | Attributes |
| --- | --- | --- |
| `<u>` `<sub>` `<sup>` `<kbd>` `<mark>` | the same | none |
| `<details>` / `<details open>` | `details` | `open`, or none |
| `<summary>text</summary>`, or none | `summary` holding a text node | none |
| the body of a `<details>` | a `div` | none |

Classes are added by the components that draw them. None of these elements can
load a resource, run script, navigate or submit. Their content goes through the
renderer like any other, so the image policy and link handling apply inside
them unchanged.

## How it is drawn

In the design language, §8 "HTML in a document". `<u>`, `<sub>` and `<sup>` are
the browser's. `<kbd>` and `<mark>` use existing tokens. A `<details>` is the
native disclosure — its summary is focusable and toggles with Enter and Space —
with the chevron and focus ring every disclosure in the product has, and its
body indented on a line.

## Where

| Surface | Drawn? |
| --- | --- |
| Reader (`MarkdownRenderer`) | Yes |
| Shared page `/s/:token` (the same renderer) | Yes |
| Rendered editor | No — the tags are text there, and are written back as they were |
| Composer's loading preview (`MarkdownBase`) | No — it stands in for the editor |

**The outline** reads a heading's text without the inline tags, as the page
shows it (`htmlAsText`). A heading that holds one therefore gets a different
slug than before; the page and the outline share it, as always.

The stored Markdown, export, search snippets and the link index are untouched.

## Shape of the change

- `src/shared/markdown/remark-html-subset.ts` — the plugin. One pairing walk,
  used twice: for `<details>` among blocks, for the inline tags within a line.
- `src/components/knowledge/markdown-html.tsx` — how `details`, `summary`, `kbd`
  and `mark` are drawn.
- `MarkdownRenderer` passes the plugin, after the callout plugin. `MarkdownBase`
  maps the four elements and never sees one without the plugin.
- `remark-known-html.ts` holds the inline tags' pattern, shared with
  `htmlAsText`.

No dependency is added.

## The rule this leaves behind

**The reader never passes HTML through.** Recorded in `CLAUDE.md` with the other
invariants. Adding a tag means adding an exact pattern and a constructed
element here, with its cases in the test file. Adding `rehype-raw`, or
`dangerouslySetInnerHTML` on document content, is a different design and needs
a spec that answers the two points above and gives the Content-Security-Policy
a `script-src`.

## Not in this change

- Any attribute, and so `<img>`, `<a>`, `<span style>`, `<div align>`.
- Markdown or tags inside a `<summary>`.
- Drawing these in the editor.
- Character references in a summary's text (`&amp;` is shown as written).

## Tests

`tests/unit/markdown-renderer-html-subset.test.tsx`:

- each tag, and the places and spellings it is read in;
- each way of writing one that must stay text;
- **"lets no markup through"**: a table of hostile inputs — `<script>`,
  `<img onerror>`, `<iframe>`, `<svg onload>`, `javascript:` links, event
  handlers on every tag of the subset, attribute and case variants of
  `<details>`, markup smuggled into a summary — each asserted to produce no
  element outside the subset and no attribute but `class` and `open`;
- that `MarkdownBase` alone draws none, and that the outline and the page agree.
