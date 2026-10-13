# Mermaid diagrams in the reader

**Status:** proposed 2026-10-13, awaiting the user's review. Nothing here is
built. The three decisions marked **(to confirm)** were made while drafting,
without being asked first; each says what the alternative was.

## Intent

A fenced block that names `mermaid` is shown as the code it was written as
(`tests/unit/code-highlight.test.tsx` holds that today). The daily-driver spec
deferred drawing it (`2026-09-29-personal-daily-driver-design.md` §2). This
draws it.

A diagram written as text is the only kind this product can hold as Markdown:
it is in the revision, it diffs, and a folder sync carries it. Architecture,
flows and sequences are what a knowledge base is asked to hold.

Success means a `mermaid` block reads as its diagram in the reader and on a
shared page, in both themes; that a block that cannot be drawn reads exactly as
it does today, with a reason; that a comment can still be made on its source;
and that no document can put an element on the page through a diagram.

**Not measured:** how many documents hold a `mermaid` block. None of this
repository's own Markdown does, and the database was not queried. If the answer
is "almost none", this can stay deferred; the spec does not depend on it.

## The decision: an image, not markup (to confirm)

Mermaid turns the author's text into an SVG string. How that string reaches
the page is the whole design.

| | How | What it rests on |
| --- | --- | --- |
| A | Set it as `innerHTML`, Mermaid's `securityLevel: "strict"` | Mermaid's own escaping and DOMPurify's allow-list |
| **B** | **Make it a `Blob`, show it with `<img>`** | **The browser's rule for an SVG used as an image** |
| C | Mermaid's `sandbox` level: a sandboxed `<iframe>` | The iframe sandbox; sizing and theme are awkward, and Mermaid calls the mode experimental |

**B is taken.** An SVG shown by `<img>` runs no script, loads no resource,
follows no link, takes no input, and its `<style>` reaches nothing outside
itself. That is what the browser does with every image; it is not a list
anyone here maintains.

A is the usual way and is not taken, for the reason the HTML subset gave
(`2026-10-12-reader-html-subset-design.md`, "Why recognise, and not parse and
sanitise"): it lets the author's input through and subtracts. Two things it
leaves in the page that B does not:

- A `<style>` inside an inline SVG applies to the **whole document**. Mermaid
  writes the author's `classDef` and `style` lines into one. A hole there
  restyles or covers the product's own interface on a page that needs no
  sign-in.
- Mermaid has had script-injection advisories. The Content-Security-Policy
  would stop a script; it is the second line, and CLAUDE.md says it is not a
  substitute for the first.

So the invariant holds as written: **nothing the author wrote is emitted as
markup.** The SVG string is never parsed by the page and never assigned to
`innerHTML`.

What B costs, accepted:

- Text in a diagram cannot be selected or found with the browser's find. The
  source is on the page beneath it, and can.
- A link in a diagram does nothing. `strict` disables them anyway.
- The diagram cannot use the product's web font (below).

### What B does not cover

To lay a diagram out, Mermaid builds it in the page, in an element it adds and
removes, because it has to measure text. For that moment the author's text is
being turned into DOM by Mermaid's code in this origin. What guards it is
`securityLevel: "strict"`, `htmlLabels: false`, and the policy's `script-src`,
which refuses an inline script or handler whoever inserted it.

Laying out in a sandboxed frame of its own origin would close that too. It
needs a route, a message protocol and a second copy of the script policy; it is
not built. It becomes worth building when an advisory shows something at layout
time that `script-src` does not stop.

## What is drawn

A fenced code block whose info string's first word is exactly `mermaid`.
Wherever a code block can be: top level, a list item, a quote, a callout, a
`<details>`.

Not drawn: `Mermaid`, `mmd`, an indented block, a block with no language whose
text happens to be a diagram. The reader does not guess a language
(`code-highlight.ts`), and does not start here.

## How

1. **The server sends what it sends today.** `ReadingPre`
   (`markdown-renderer.tsx`) sees that its `<code>` carries `language-mermaid`
   and wraps the same code block in `MermaidBlock`, a client component. The
   page's HTML holds the code as text, with its `data-review-path`. Without
   script, or before it runs, the block is the code block it is now.
2. **`MermaidBlock` asks for a drawing.** It reads the source from its own
   `<code>` when it mounts, as the copy button does, so the code is not sent a
   second time as a prop. It joins a queue that is one module's, for the page.
3. **The queue loads Mermaid once**, by `import("mermaid")`, on the first
   request. A page with no `mermaid` block never loads it. It is configured
   once: `startOnLoad: false`, `securityLevel: "strict"`, `htmlLabels: false`,
   `suppressErrorRendering: true`, `theme: "base"` with the variables below,
   and the font below.
4. **One at a time, in document order**, yielding to the browser between
   drawings: Mermaid keeps state between calls, and a page must stay usable
   while its diagrams arrive.
5. **`mermaid.render` returns a string.** If it holds no `<foreignObject`, it
   becomes `new Blob([svg], { type: "image/svg+xml" })`, a URL from
   `URL.createObjectURL`, and the `src` of an `<img>`. The URL is revoked when
   the block redraws or unmounts. `bindFunctions`, which Mermaid returns for
   click handlers, is never called.

### When a block is not drawn

It stays the code block it was, and one line under it says why. None of these
is an error, and the page renders.

| Why | What it says |
| --- | --- |
| Mermaid cannot parse it | `Could not draw this diagram:` and the first line of Mermaid's message, to 200 characters, as text |
| Longer than 10,000 characters | `This diagram is too long to draw.` |
| More than 50 diagrams before it in the document | `Too many diagrams on this page; this one is left as code.` |
| The drawing holds a `<foreignObject>` | `This kind of diagram cannot be drawn here yet.` |
| Mermaid could not be loaded | `Diagrams could not be loaded.` |

The limits are constants beside the queue, as the highlighter's are beside it.
They bound what a document can cost the reader's own tab, which matters most on
a shared page. **Known ceiling:** one drawing cannot be interrupted, since
Mermaid needs the DOM and cannot run in a worker. A single hostile block inside
the limits can still stall the tab that opened it, and only that tab. Mermaid's
own `maxEdges` (500) stays at its default as the bound inside one drawing.

**`<foreignObject>`.** With `htmlLabels: false` the common diagrams are pure
SVG. One that still embeds HTML draws unevenly across browsers as an image, and
a diagram with its labels missing is a wrong picture, which is worse than code.
So it is refused, by a rule that does not depend on a list of diagram types.
Verification records which types this turns away; admitting one later is an
amendment here.

## How it looks

Drawn, a block is a `<figure>`:

- **The image**, at the size Mermaid gave it, in a box that scrolls sideways
  when it is wider than the column. Tables and code already do that; shrinking
  a wide diagram to fit makes it unreadable.
- **`Source`**, a native `<details>`, closed, holding the code block as it was,
  copy button included. It uses the disclosure the HTML subset draws
  (`MarkdownDetails`).

`alt` is `Diagram (<type>). Its source follows.`, the type being what Mermaid
reports. The source in the disclosure is the text alternative.

**Colour.** Mermaid's `base` theme is given its variables from the tokens, read
with `getComputedStyle` when a drawing is made, so no colour is declared
outside the CSS layer:

| Mermaid | Token |
| --- | --- |
| background | none (transparent; the figure sits on the page) |
| node fill | `--kh-bg-subtle` |
| node and cluster border | `--kh-border-strong` |
| text | `--kh-text` |
| lines and arrowheads | `--kh-text-muted` |
| note and highlight fill | `--kh-highlight` |

No token is added. The mapping, and the rule that a diagram takes colour from
nowhere else, go into the design language as §8 "Diagrams in a document", in
the same change as the code. A colour the author writes in the diagram
(`style A fill:#f00`) is theirs and is kept; it is inside the image.

**Theme.** When `data-theme` on `<html>` changes, each drawn block is drawn
again, through the same queue. One `MutationObserver`, the queue's.

**Font.** An image cannot use a font the page loaded, so a diagram is measured
and drawn in `ui-sans-serif, system-ui, sans-serif`, not `--kh-font-sans`.
Measuring in one font and drawing in another clips labels; using the system's
for both does not.

**Print.** The image prints. The source stays closed.

**Layout shift.** A block changes height when it is drawn. The review rail and
the outline's active heading already follow size changes (`ResizeObserver`).
A page opened at `#heading` below a diagram can land off by the difference;
that is measured in verification, and left alone unless it is seen.

## Comments (to confirm)

A comment on a `mermaid` block is a comment on its **source**, as on any code
block (`2026-10-13-review-anchors-and-owner-threads-design.md` §3). The `<code>`
element, its path and its text are unchanged, so the anchor, `anchor_json` and
the server are untouched. To make one, open `Source` and select.

The alternative was commenting on the picture: a region, or a node. That is a
new kind of anchor, and what it points at moves whenever the layout does. Not
built.

Two changes in the page, both about a quote inside a closed disclosure, and
both equally true of an author's own `<details>`:

- `focusReviewAnchor` opens every `<details>` the quote is inside before it
  scrolls to it. Today it scrolls to something with no box.
- A passage marker for such a quote sits beside the closed disclosure, not
  where a range with no rectangle says. The plan checks first what the marker
  does there today and writes the failing test from that.

## Where

| Surface | Drawn? |
| --- | --- |
| Reader, current and past revisions (`MarkdownRenderer`) | Yes |
| Shared page `/s/:token` (the same renderer) **(to confirm)** | Yes |
| Rendered editor | No. It is a code block there, and is written back as it was |
| Composer's loading preview (`MarkdownBase`) | No. It stands in for the editor |

The shared page is drawn because the diagram is the document. The cost falls on
the visitor's browser, not the server, inside the limits above. The alternative
was code only for anonymous readers.

The stored Markdown, export, search, the link index and the editor are
untouched. A `[[wikilink]]` inside a diagram is text in code, as now.

## Content-Security-Policy

`img-src 'self'` becomes `img-src 'self' blob:`. A `blob:` URL can only be
made by script already running in this origin, which the nonce decides. A
document cannot name one: `isAllowedMarkdownImageSrc` refuses the scheme, and
that does not change.

The directive is written in three places and all three change together:
`content-security-policy.ts`, and both headers in `next.config.ts`. The
middleware's header replaces the other on pages; a change in one only is lost.

`script-src` does not change. Mermaid's chunks are loaded by a script that
carries the nonce, which `strict-dynamic` allows. There is no `style-src` to
change.

## Dependency

`mermaid`, pinned `~12.2`, as `highlight.js` is pinned. It is large and brings
d3, a parser and layout engines. It is reached only through `import()`:

- `tests/unit/composer-bundle.test.ts` gains it: the composer's graph must not
  reach `mermaid` at all.
- The same walk, static imports only, from the reader's page: `mermaid` is not
  in the first load.

Verification records the size of the chunks a page with one flowchart fetches.

## Assumed of Mermaid 12, and what happens if not

Written from Mermaid 10 and 11. The plan's first task checks each against the
installed version, before anything else is built.

| Assumed | If false |
| --- | --- |
| `render(id, text)` resolves to `{ svg, diagramType }` and does not need the result inserted into the page | B does not work as written; stop and return to this spec |
| `securityLevel`, and the keys that matter, cannot be changed by `%%{init}%%` in the source | Strip a leading directive before drawing; say so here |
| `htmlLabels: false` gives pure SVG for flowchart, sequence, class, state, ER, gantt and pie | The `<foreignObject>` rule turns those away; the feature is not worth shipping; return here |
| `suppressErrorRendering` keeps Mermaid's error graphic out of the page | Remove the element Mermaid leaves, by the id it was given |
| No `eval` or `new Function` in production | The production build fails the e2e below, since `unsafe-eval` is development only; return here |

Checked against `mermaid@12.2.0` (`../verification/2026-10-13-reader-mermaid.md`):
the second row was false by default. A `%%{init}%%` directive could turn HTML labels on, so a
flowchart came out with `<foreignObject>`. Done: `htmlLabels` is added to Mermaid's `secure`
list (the installed default is `secure`, `securityLevel`, `startOnLoad`, `maxTextSize`,
`suppressErrorRendering`, `maxEdges`), and the check script tries a directive before the first
line, a directive after it, and YAML frontmatter `config:`; none yields `<foreignObject>`. The
`<foreignObject>` refusal stays as the backstop. The other four rows hold.

## Shape of the change

- `src/components/knowledge/mermaid-block.tsx`: the client component. The
  figure, the disclosure, the reason.
- `src/components/knowledge/mermaid-queue.ts`: the load, the configuration,
  the order, the limits, the theme observer. No React.
- `markdown-renderer.tsx`: `ReadingPre` chooses the wrapper.
- `review-selection.ts`, `review-passage-markers.tsx`: the two changes above.
- `content-security-policy.ts`, `next.config.ts`: `blob:`.
- `markdown-image-policy.ts`: its comment, which names the directive.

## Tests

Each line is a requirement above.

**Unit**

- A `mermaid` fence is wrapped; `Mermaid`, `mmd`, no language, and an indented
  block are not. The server's HTML for a wrapped block holds the code as text,
  its `data-review-path`, and no `<img>`.
- The queue, with Mermaid replaced by a stub: one at a time and in order; a
  block over 10,000 characters, the 51st block, a drawing with
  `<foreignObject>`, a `render` that throws and an `import` that fails each
  give their reason and leave the code; a later block is still drawn after an
  earlier one fails; the object URL is revoked on redraw and on unmount.
- The policy holds `img-src 'self' blob:` on a page and on `/s/*`, and
  `next.config.ts` says the same in both places.
- `isAllowedMarkdownImageSrc("blob:…")` is still false.
- The two bundle assertions.

**End to end**, against the production build, where there is no `unsafe-eval`

- A flowchart and a sequence diagram are drawn in the reader and on a shared
  page: an `<img>` with a `blob:` source and a natural size above zero.
- A block with a syntax error shows its code and the reason, and the block
  after it is drawn.
- Switching theme gives each image a new source.
- **Hostile**, in `tests/e2e/zz-mermaid-hostile.spec.ts`, on a shared page: a
  label holding `<img src=x onerror=…>`; a label holding `<script>`; `click A
  href "javascript:…"`; `%%{init: {"securityLevel":"loose"}}%%` before each of
  those; `classDef` with `fill:url(https://example.invalid/x)` and with
  `position:fixed`. For each: no flag was set on `window`, no request left the
  origin, the figure holds one `<img>` and one `<details>` and nothing else,
  and a control outside the figure has the computed style it had before.
- A comment on the source: open `Source`, select, comment, reload, choose the
  thread; the disclosure opens and the quote is selected.
- The same for a quote inside an author's `<details>`.
- A document with a diagram, opened in the rendered editor and saved without a
  change: the fence is the same bytes, and the reader still draws it.

## Documents changed with the code

- `CLAUDE.md`: the reader invariant gains the diagram rule (drawn as an image,
  never as markup; do not switch to `innerHTML` to make text selectable); the
  script invariant's `img-src 'self'` becomes `img-src 'self' blob:`.
- `frontend-design-language.md` §8: "Diagrams in a document".
- `README.md`: a row in "Current canonical documents".
- `2026-09-29-personal-daily-driver-design.md` §2: a note that Mermaid is no
  longer deferred, pointing here. The original line stays.
- `2026-10-12-content-security-policy-design.md`: a note on `blob:`, pointing
  here.

## Not in this change

- Drawing in the rendered editor, or a live preview while writing.
- Comments on the picture.
- Saving a diagram as a file; zoom and pan.
- Drawing on the server. It needs a browser there.
- Other diagram languages (PlantUML, Graphviz) and maths.
- The user guide. It gets a section when this ships, as its own change.
