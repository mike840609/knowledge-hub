# Mermaid diagrams in the reader

**Status:** agreed with the user on 2026-10-13, including the three decisions
first made in drafting; built by `../plans/2026-10-13-reader-mermaid.md`. Where
the build found something other than what was drafted, the section says so in
place: "Assumed of Mermaid 12", "How" (steps 3 and 4), "When a block is not
drawn", "How it looks", "Comments" and "Tests". A review before merge
(2026-10-14) found that a diagram could make the reader's browser fetch from
elsewhere while it was laid out; "What B does not cover", "How" (steps 3, 5
and 6), "When a block is not drawn" and "Content-Security-Policy" are written
from what it found.

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
that the page the reader is left with holds nothing of a diagram but an image;
and that while a diagram is laid out, no element the author's text chose is in
the page. The last is shown for the types that are drawn, in Chromium, by the
checks "What B does not cover" names; that section also says where it stops.

**Not measured:** how many documents hold a `mermaid` block. None of this
repository's own Markdown does, and the database was not queried. If the answer
is "almost none", this can stay deferred; the spec does not depend on it.

## The decision: an image, not markup

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
`innerHTML`. That is the page the reader is left with; the moment Mermaid
spends laying a diagram out is the exception, named under "What B does not
cover".

What B costs, accepted:

- Text in a diagram cannot be selected or found with the browser's find. The
  source is on the page beneath it, and can.
- A link in a diagram does nothing: it is inside an image. (`strict` does
  not disable an `href` link, as this once said. Mermaid writes it into the
  drawing, and the image is what makes it inert.)
- The diagram cannot use the product's web font (below).

### What B does not cover

To lay a diagram out, Mermaid builds it in the page, in an element it adds and
removes, because it has to measure text. For that moment the author's text is
being turned into DOM by Mermaid's code in this origin, and the rule for an
image says nothing about it. Refusing a drawing afterwards does not undo what
that moment did.

The review before merge found what that moment could do in 12.2.0, each by
running it (`../verification/2026-10-13-reader-mermaid.md`, "Review fixes"):

- An `architecture-beta` block wrote its icon text into the page as HTML,
  through a sanitiser whose defaults let `<video>`, `<img>` and `<a>` through.
  A `<video src>` of the author's choosing was fetched from another origin, on
  a shared page, and the drawing was refused only afterwards.
- Text holding `$$…$$` is written as an HTML label whatever `htmlLabels` says,
  through the same sanitiser. That reached a sequence diagram and a class
  diagram, which are drawn.
- A diagram's own config could put a `url()` into the `<style>` Mermaid adds
  for the drawing (`themeCSS`, `fontFamily`), and choose its theme.

What guards the moment now, each danger with the guard that stops it:

| At layout time | What stops it |
| --- | --- |
| A type that writes the author's text into the page as HTML (`architecture`, `eventmodeling`), or any type nobody has examined | The type is found before anything is laid out, and only the types on a list are drawn ("The types that are drawn") |
| Text holding `$$…$$` in a drawn type, written as an HTML label | Mermaid's sanitiser is given a configuration of ours (`dompurifyConfig`) that leaves a line break and no attribute (`data-` and `aria-` ones included), so what is written is text. The key is in `secure` |
| HTML labels turned back on by the diagram's own text | `htmlLabels` in `secure` |
| A style, a font, a theme or a layout engine other than the default (ELK, in 12.2.0) chosen by the diagram's own text | `themeCSS`, `fontFamily`, `altFontFamily`, `theme`, `themeVariables` and `layout` in `secure`. `layout` keeps a diagram from choosing another engine; it does not keep ELK from loading, since a flowchart loads it by default ("Dependency") |
| A sankey's `linkColor`, used as a paint, so that `url(https://…)` in it is a fetch | `linkColor` in `secure`. It was found resting on `img-src` alone, and is closed |
| The `<style>` holding the author's `classDef` and `style` lines reaching the rest of the page | Mermaid scoping its rules to the drawing's own id (it compiles them under that selector; read in 12.2.0's `createUserStyles`). Nothing else: `script-src` says nothing about styles |
| A `url()` in an author's `style` or `classDef` line. Class, state and block diagrams accept one; the flowchart parser refuses it | `img-src` only |
| The flowchart shape that loads an image by its URL (`A@{ img: "…" }`): Mermaid makes an `Image` of it in the page to measure it | `img-src` only |
| A sequence participant's icon property (`properties A: {"icon": "https://…"}`): Mermaid writes an SVG `<image href>` of it into the page | `img-src` only |
| A C4 diagram's `UpdateElementStyle(a, $bgColor="url(//host/…)")`: the colour is used as a paint | `img-src` only |
| An audio or video element | `media-src 'none'`, behind the first two rows |
| An inline script or handler | `script-src`, which refuses one whoever inserted it |

`secure` is Mermaid's list of the keys a `%%{init}%%` directive or frontmatter
`config:` may not set. Mermaid applies it at every depth of that config, and
not to our own `initialize`, so the theme still follows the page. Without an
entry, the setting it names guards nothing.

For the four rows that say `img-src` only (a style or `classDef` `url()`, the
flowchart image shape, a sequence participant's icon, a C4 style colour):
nothing before layout tells such a diagram from another with certainty, so the
policy is the guard and there is no line in front of it. A URL on another
origin is refused, with an `img-src` violation, and nothing leaves. A URL on
this origin is loaded, which a Markdown image in the same document can already
do. These four are the ones found, each by running it; a fifth, the sankey's
`linkColor`, was found the same way and is closed by `secure`. The script
shows each of the four refused, and fails the run if one is not (or if its
fetch is of a kind `img-src` does not cover); that is evidence about the places
tried, not a proof that no fifth remains.

What the checks show, and no more. `scripts/test/mermaid-assumptions.mjs` lays
each drawn type out in Chromium, plain and with hostile HTML in each place the
script reaches for that type, once as it is and once following `$$…$$`, with a
`MutationObserver` on the document from before Mermaid is loaded. The only
HTML elements seen were ones Mermaid's own code makes, none taking its tag or
an attribute's name from the author's text: its container `div` and the
`style` in it, the `div` it measures maths in and the `div` and `span` around
an HTML label, and, for a mindmap, the hidden container, canvases and
stylesheet of the layout engine it uses. That stylesheet is the one thing a
layout leaves behind: a `<style>` in `<head>` holding one fixed rule of the
engine's, `.__________cytoscape_container { position: relative; }`, added by
the first mindmap and never removed. No request left the origin, and the
policy had nothing to refuse. That is evidence from the places tried, not a
proof about every input.

What is not covered:

- **There is no `default-src`.** A kind of fetch no directive names (a font, a
  stylesheet, a connection) is open if something at layout time can start one.
  None was found. Adding the directive could break things this change cannot
  see from here, so it is left, as a known gap.
- **Chromium only.** No other engine was run. Whether another engine fetches
  `fill: url(https://…#id)` or `filter: url(…)` from that `<style>` as
  something other than an image is not known.
- **Every type's parser reads the author's text**, drawn or not, since the type
  is found by parsing. Parsing was seen to add nothing to the document.
- **The `<style>` is in the page for that moment**, with the author's lines in
  it. That is the very thing "The decision" holds against option A; B keeps it
  out of the page the reader is left with, and Mermaid's scoping is all that
  confines it while it is there.

Laying out in a sandboxed frame of its own origin would take the moment out of
this origin altogether. It needs a route, a message protocol and a second copy
of the script policy. This once said it becomes worth building "when an
advisory shows something at layout time that `script-src` does not stop". The
review showed exactly that. It was closed with the guards above and the frame
is still not built; it is what replaces these lists if they are found short
again.

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
   script, or before it runs, the block is the code block it is now: the
   server's markup for it is a `<figure>` holding an open `<details>` whose
   `<summary>` is hidden, and the code block inside that (see "How it looks").
2. **`MermaidBlock` asks for a drawing.** It reads the source from its own
   `<code>` when it mounts, as the copy button does, so the code is not sent a
   second time as a prop. It joins a queue that is one module's, for the page.
3. **The queue loads Mermaid once**, by `import("mermaid")`, on the first
   request. A page with no `mermaid` block never loads it. It is configured
   before each drawing, by `initialize`, because the theme's colours are read
   then: `startOnLoad: false`, `securityLevel: "strict"`, `htmlLabels: false`,
   `suppressErrorRendering: true`, `secure` (the keys a diagram's own text may
   not set), `dompurifyConfig` (what its sanitiser leaves of a label),
   `theme: "base"` with the variables below, and the font below.
4. **One at a time, in document order**, yielding to the browser between
   drawings: Mermaid keeps state between calls, and a page must stay usable
   while its diagrams arrive. **Only the newest request for a block is drawn.**
   A request that a newer one for the same block has superseded, or whose block
   has left the page, is dropped before it is laid out: the queue asks again
   after Mermaid has loaded and after the type is found, the two steps that
   wait, so `render` is never called for it. (`parse` may have been; it lays
   nothing out.) One that is superseded while it is being laid out finishes,
   and makes no URL (`createDiagramQueue`, `mermaid-queue.ts`). The theme is read with a store
   whose server value differs from the client's, so every hydrated page asks
   twice; without this rule every diagram was drawn twice in production.
5. **The type is found before anything is laid out.** `mermaid.parse` reads
   the text the way `render` does as far as the type: the same frontmatter,
   directives and comments are taken off and the same detectors asked (read in
   12.2.0's `processAndSetConfigs` and `Diagram.fromText`, which both call). It
   stops there, with nothing built in the page. Only a type on the list is
   handed to `render`; any other, and a text no type can be told of, is left as
   code and `render` is never called.
6. **`mermaid.render` returns a string.** If it holds no `<foreignObject`, two
   things in it are mended (below), and it becomes
   `new Blob([svg], { type: "image/svg+xml" })` and a URL from
   `URL.createObjectURL`. The queue then loads that URL in an `Image`: only if
   it loads, within ten seconds, does it become the `src` of the `<img>`, and
   otherwise it is revoked and the block is left as code. The URL is revoked when the block
   redraws, unmounts, or is asked for again and declined. `bindFunctions`,
   which Mermaid returns for click handlers, is never called.

**The two things mended.** Mermaid's string is HTML's serialisation, and an
image is parsed as XML. A link (`click A href "…"`, a class `link`, a sequence
`link`) is written as `xlink:href` with the prefix undeclared, and a
non-breaking space in sequence, class, state, gantt or pie text as `&nbsp;`,
which XML does not know. Either made the whole picture fail to load. On the
string, before the `Blob`: `&nbsp;` becomes `&#160;`, and
`xmlns:xlink="http://www.w3.org/1999/xlink"` is declared on the root `<svg`
when the string uses the prefix and the root does not declare it. Nothing else
is rewritten.

### The types that are drawn

By the id Mermaid's detector gives each (`DRAWN_TYPES`, `mermaid-queue.ts`):
`flowchart-v2` (`flowchart` and `graph`), `sequence`, `classDiagram`,
`stateDiagram`, `er`, `gantt`, `pie`, `mindmap`, `timeline`, `quadrantChart`,
`gitGraph`, `requirement`, `c4`, `sankey`, `xychart`, `block`, `kanban`,
`packet`, `radar`, `treemap`.

A type is on the list only because the assumptions script has laid it out with
hostile text and seen what "What B does not cover" describes. Not on it:
`architecture` and `eventmodeling`, which write the author's text into the page
as HTML; `journey`, whose drawing always holds a `<foreignObject>`; and every
type nobody has examined (`flowchart-elk`, `agentflow`, `swimlane`, `treeView`,
`ishikawa`, `venn`, `usecase`, `wardley`, `cynefin`, the `railroad` family,
`info`). Admitting one is an amendment here, made after the script passes with
it. A type Mermaid gains in a later version is not drawn until then.

### When a block is not drawn

It stays the code block it was, and one line under it says why. None of these
is an error, and the page renders. Nothing the queue declines is a throw: that
includes a failure to make the object URL, which is shown as
`This kind of diagram cannot be drawn here yet.` A failure to revoke one is
ignored, and the block is still drawn.

| Why | What it says |
| --- | --- |
| A type on the list that Mermaid cannot parse, or cannot lay out | `Could not draw this diagram:` and the first line of Mermaid's message, to 200 characters, as text |
| A type that is not on the list, or text no type can be told of | `This kind of diagram cannot be drawn here yet.` |
| Longer than 10,000 characters | `This diagram is too long to draw.` |
| More than 50 diagrams before it in the document | `Too many diagrams on this page; this one is left as code.` |
| The drawing holds a `<foreignObject>`, gives no size, its URL cannot be made, or the URL does not load as an image (or the browser does not say, in ten seconds) | `This kind of diagram cannot be drawn here yet.` |
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
So it is refused. This rule is about the picture, and comes after layout; what
may be laid out at all is the list above. Among the drawn types it turns away a
sequence diagram whose message, note or `loop` label holds `$$…$$`, a class
diagram whose class label or member does, and a sequence diagram whose own
config sets `textPlacement: fo`. It does not turn away every place: `$$…$$` in
a sequence title or `box`, or in a class note or relation label, is drawn as the
text it is, as a flowchart does. **Known limitation:** a sequence participant or
actor alias holding `$$…$$` (`participant A as $$x^2$$ hello`) is drawn, with
that participant's label missing, because Mermaid leaves no `<foreignObject>`
for the rule to see. Maths is not drawn, and this is not fixed here.

**A picture that does not load.** An `<img>` says nothing when its source is
not an image, so the reader would see a broken picture over a closed source.
The queue asks first, and refuses what does not load, whatever the cause.

## How it looks

Drawn, a block is a `<figure>`:

- **The image**, at the size Mermaid gave it, in a box that scrolls sideways
  when it is wider than the column. Tables and code already do that; shrinking
  a wide diagram to fit makes it unreadable.
- **`Source`**, a native `<details>`, closed, holding the code block as it was,
  copy button included. It carries the chevron every `summary` has
  (`globals.css`); it is not `MarkdownDetails`.

The code block is always inside that `<details>`, drawn or not, and is never
moved: a comment is anchored in its DOM nodes, so what changes is the
disclosure around it. Before a drawing arrives, and for good when there is
none, the `<details>` is open and its `<summary>` is hidden, so the block reads
as the code block it is today. When a drawing arrives the `<details>` closes
and its `<summary>` shows `Source`. A redraw (a change of theme, or new source
in the same place) does not close a source the reader has opened; when the new
source cannot be drawn, the source opens and says why.

`alt` is `Diagram (<type>). Its source follows.`, the type being what Mermaid
reports. The source in the disclosure is the text alternative.

**Colour.** Mermaid's `base` theme is given its variables from the tokens, read
with `getComputedStyle` when a drawing is made, so no colour is declared
outside the CSS layer:

| Mermaid | Token |
| --- | --- |
| background | none (transparent; the figure sits on the page) |
| node and cluster fill | `--kh-bg-subtle` |
| node and cluster border | `--kh-border-strong` |
| text | `--kh-text` |
| lines and arrowheads | `--kh-text-muted` |
| note fill | `--kh-highlight` |

No token is added. The mapping, and the rule that a diagram takes colour from
nowhere else, go into the design language as §8 "Diagrams in a document", in
the same change as the code. A colour the author writes in the diagram
(`style A fill:#f00`) is theirs and is kept; it is inside the image.

**Theme.** When `data-theme` on `<html>` changes, each drawn block is drawn
again, through the same queue. One `MutationObserver`, the queue's.

**New source in the same place.** A block is also drawn again when the server
sends it other source while it stays mounted, as a `router.refresh()` after an
edit does: React keeps a block by its position, so the same `MermaidBlock`
would otherwise show the new code beside the old picture. `MermaidBlock` looks
again when its theme or its `children` change, and `children` is a new element
only when the server sends one, not when the block's own state changes. Until
the replacement arrives the previous picture stays, as it does for a theme. Choosing
`?revision=N` does not depend on this: Next keys the page by its search params,
so that mounts a new block.

A refresh sends a new element whether or not the source changed, and every
`router.refresh()` does, after a save or a change to the tree. Looking again
is not drawing again: `MermaidBlock`
remembers the theme, the source and the block's place among the page's
diagrams that it last asked the queue for, and asks again only when one of the
three is other than it was. One drawing cannot be interrupted, and a small
source can be a long one: measured in review, a 258-character flowchart with
484 edges held the main thread for 6.5 s. The place is one of the three
because the limit of fifty counts by it. "Diagrams could not be loaded" is not
remembered, so the next refresh tries again. A block mounted a second time
asks again.

**Font.** An image cannot use a font the page loaded, so a diagram is measured
and drawn in `ui-sans-serif, system-ui, sans-serif`, not `--kh-font-sans`.
Measuring in one font and drawing in another clips labels; using the system's
for both does not.

**Print.** The image prints. The source stays closed.

**Layout shift.** A block changes height when it is drawn. The review rail and
the outline's active heading already follow size changes (`ResizeObserver`).
A page opened at `#heading` below a diagram can land off by the difference;
that is measured in verification, and left alone unless it is seen. Measured in
Chromium, it was not: the heading stayed 16 px from the top of the pane through
the drawing, as the browser's scroll anchoring moved the pane to keep it there.
Other engines were not measured.

## Comments

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
- A passage marker for such a quote sits beside the outermost closed
  disclosure around the quote, whatever rectangle the range reports. This was
  first written as "not where a range with no rectangle says". Found in the
  browser: Chromium does report rectangles for text inside a closed
  `<details>`, laid out as if it were open, so the marker was placed over
  whatever follows the figure (y=528 for a figure ending at 473). The marker is
  therefore placed by the disclosure (`shownTop`, `review-passage-markers.tsx`),
  not by testing for a missing rectangle, except for a quote in the
  disclosure's own `<summary>`, which is shown. Unit test:
  `tests/unit/review-marker-position.test.tsx`.

## Where

| Surface | Drawn? |
| --- | --- |
| Reader, current and past revisions (`MarkdownRenderer`) | Yes |
| Shared page `/s/:token` (the same renderer) | Yes |
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

`media-src 'none'` is added. Nothing in the product plays audio or video, and
an element with a `src` that reached the page at layout time would otherwise be
fetched from anywhere, since there is no `default-src` ("What B does not
cover").

Each directive is written in three places and all three change together:
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

**ELK.** Mermaid 12.2.0's default layout engine is ELK (`elkjs` 0.9.3, licensed
EPL-2.0; Mermaid is MIT), a chunk of its own: 1,618,161 bytes in
`node_modules/mermaid/dist/chunks/mermaid.esm.min/`, and the 1,448,145-byte
chunk, the largest, in the production build the verification measured. A
flowchart fetches it with no help from the diagram's text; a sequence diagram
does not. It is part of what Mermaid costs, and a dependency whose licence is
not Mermaid's. `layout` in `secure` does not change that: it keeps a diagram
from choosing another engine (`layout: dagre` changed the drawing and fetched a
further chunk until the key was in `secure`), and `layout: elk` asks for what is
already the default.

Before the version is changed, and after: `make test-mermaid-assumptions`. The
three lists in `mermaid-queue.ts` are true of 12.2.0 because that script saw
them hold; nothing says they hold for another version until it has run.

## Assumed of Mermaid 12, and what happens if not

Written from Mermaid 10 and 11. The plan's first task checks each against the
installed version, before anything else is built.

| Assumed | If false |
| --- | --- |
| `render(id, text)` resolves to `{ svg, diagramType }` and does not need the result inserted into the page | B does not work as written; stop and return to this spec |
| `securityLevel`, and the keys that matter, cannot be changed by `%%{init}%%` in the source | Keep the key out of the source's reach with `secure`; strip a directive only if that does not hold; say so here |
| `htmlLabels: false` gives pure SVG for flowchart, sequence, class, state, ER, gantt and pie | The `<foreignObject>` rule turns those away; the feature is not worth shipping; return here |
| `suppressErrorRendering` keeps Mermaid's error graphic out of the page | Remove the element Mermaid leaves, by the id it was given |
| No `eval` or `new Function` in production | The production build fails the e2e below, since `unsafe-eval` is development only; return here |

Checked against `mermaid@12.2.0` (`../verification/2026-10-13-reader-mermaid.md`):
the second row was false for `htmlLabels`. In 12.2.0 a diagram's own text can turn HTML
labels on, by a `%%{init}%%` directive anywhere in the text or by YAML frontmatter `config:`,
so a flowchart came out with `<foreignObject>`. Done: `htmlLabels` is added to Mermaid's
`secure` list in `initialize` (`mermaid-queue.ts`), which was then the installed default
(`secure`, `securityLevel`, `startOnLoad`, `maxTextSize`, `suppressErrorRendering`,
`maxEdges`) plus `htmlLabels`, and has gained eight keys since (below). No directive is stripped. `scripts/test/mermaid-assumptions.mjs`
holds a copy of that list and tries a directive before the first line, a directive after it,
and frontmatter `config:`: none yields `<foreignObject>`, and the script passes. The
`<foreignObject>` refusal stays as the backstop. The other four rows held: `render` resolves
to `{ svg, diagramType }` without the result being inserted into the page; flowchart,
sequence, class, state, ER, gantt, pie and mindmap all came out as pure SVG that loads as an
image; a block Mermaid cannot parse rejects and leaves nothing in the page; and the production
script policy (no `unsafe-eval`) refused nothing, so there is no `eval`.

Assumed since the review, and checked by the same script, which exits non-zero
when one fails:

| Assumed | If false |
| --- | --- |
| `parse` names the type `render` then draws, and adds nothing to the document | The type cannot be decided before layout by this means; no type may be drawn until another is found |
| Each type on the list is laid out with no element of the author's choosing in the page, plain and with hostile text | Take the type off the list |
| A directive or frontmatter cannot set a key in `secure`, at any depth: the drawing is the same string with it and without | The key guards nothing; return to "What B does not cover" |
| With `dompurifyConfig` set, text holding `$$…$$` leaves no element but Mermaid's own wrappers, and a directive cannot replace it | Take sequence and class diagrams off the list |
| The image shape, a `url()` in a style line, a sequence participant's icon and a C4 style colour are image fetches, which `img-src` refuses elsewhere | A fetch the policy does not name leaves the origin; refuse the type that makes it |
| A sankey's `linkColor` and `layout: dagre`, carried by a directive or by frontmatter, change nothing: the drawing is the same string, the policy refuses nothing, no further chunk is fetched | The key guards nothing; return to "What B does not cover" |
| `<br data-x=1 aria-label=y>` in text holding `$$…$$` leaves a bare `<br>` (a sequence message) or no attribute (a class label) | The sanitiser's configuration lets an attribute through; return to "What B does not cover" |
| A drawing with a link or a non-breaking space loads as an image once mended | The picture is refused by the load check, and the block is left as code |

## Shape of the change

- `src/components/knowledge/mermaid-block.tsx`: the client component. The
  figure, the disclosure, the reason.
- `src/components/knowledge/mermaid-queue.ts`: the load, the configuration,
  the three lists (drawn types, `secure`, the sanitiser), the order, the
  limits, the mending and the load check, the theme observer. No React.
- `markdown-renderer.tsx`: `ReadingPre` chooses the wrapper.
- `review-selection.ts`, `review-passage-markers.tsx`: the two changes above.
- `content-security-policy.ts`, `next.config.ts`: `blob:`, and `media-src 'none'`.
- `markdown-image-policy.ts`: its comment, which names the directive.
- `package.json`, `package-lock.json`: `mermaid`, `~12.2.0`.
- `scripts/test/mermaid-assumptions.mjs`: the tables above, run in a browser under
  the production policy's script and fetch directives. `make test-mermaid-assumptions`
  (`package.json`, `Makefile`); run it before and after changing `mermaid`'s version.
  It is not in `make verify` or CI.
- `tests/unit/mermaid-assumptions-lists.test.ts`: the script's copies of the three
  lists are the queue's.
- `tests/unit/review-marker-position.test.tsx`: where a marker sits for a quote
  in a closed disclosure.

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
  earlier one fails; a `toUrl`, `revoke` or `pause` that throws stops nothing
  after it; the object URL is revoked on redraw, on unmount, and when a drawn
  block is asked for again past either limit; and only the newest request for
  a block is drawn, so a block asked for twice, or one that left the page
  while it waited, costs Mermaid one call or none. The type comes first: each
  id on the list is drawn; a type not on it, a text of no type, and a failure
  to find the type are refused with `render` never called; a listed type that
  does not parse says what Mermaid said. A drawing that does not load as an
  image is refused and its URL revoked, the picture on show kept until the new
  one loads; so is one whose check has not settled in ten seconds (fake timers),
  after which the next block is drawn and no timer is left. A block asked again
  or forgotten while Mermaid loads, or while its type is found, is never handed
  to `render`, and gives back no picture it did not make. `&nbsp;` and an undeclared `xlink:` are mended, and a string with
  neither is passed on as Mermaid returned it.
- `MermaidBlock`, with the queue stubbed (`mermaid-block-client.test.tsx`): the
  picture, `Source` and the reason as an outcome gives them; the code as
  written and the block's place among the page's diagrams; a block asked again
  for a theme, for new source in the same place and for a new place, and not
  for the same children or for the same source sent again; the first drawing
  still shown when the same source arrives before it does; asked again after
  "could not be loaded" and not after another reason; asked again when mounted
  a second time; the picture of the old source kept until the new one arrives;
  a late result not shown; the source opened when a drawn block's new source
  cannot be drawn; `forget` on unmount; the code block's nodes unchanged.
- The policy holds `img-src 'self' blob:` and `media-src 'none'` on a page and
  on `/s/*`, has no `default-src`, and `next.config.ts` says the same in both
  places.
- The assumptions script's copies of the drawn types, `secure` and the
  sanitiser's configuration are the queue's, and no key has left `secure`
  (`mermaid-assumptions-lists.test.ts`).
- `isAllowedMarkdownImageSrc("blob:…")` is still false.
- The two bundle assertions.

**End to end**, against the production build, where there is no `unsafe-eval`

- A flowchart and a sequence diagram are drawn in the reader and on a shared
  page: an `<img>` with a `blob:` source and a natural size above zero.
- A block with a syntax error shows its code and the reason, and the block
  after it is drawn.
- Switching theme gives each image a new source.
- A flowchart with a `click … href` and a sequence diagram with a
  non-breaking space are each drawn, with a natural size above zero; clicking
  the first goes nowhere.
- **Hostile**, in `tests/e2e/zz-mermaid-hostile.spec.ts`, on a shared page,
  twenty blocks.
  Nine against the picture: a label holding `<img src=x onerror=…>`; a label
  holding `<script>`; `click A href "javascript:…"`; the `%%{init}%%` directive
  that sets `securityLevel: "loose"` and turns HTML labels on before each of
  those three; `click A call alert()`; `classDef` with `position:fixed`; and a
  label that closes the SVG and opens an `<img onerror>`. All nine are drawn.
  (This once held a tenth, a flowchart `classDef … fill:url(https://…)`. The
  flowchart parser refuses that with a parse error, as it does `style` and
  `background:` forms of it, so it proved nothing about `url()`. It is replaced
  by the state diagram below.)
  Eleven against the layout: an `architecture-beta` block whose icon text holds
  a `<video src>` on another origin, and an `eventmodeling` block holding an
  `<img src>` (neither type is drawn: each is left as code, open, with
  `This kind of diagram cannot be drawn here yet.`); a sequence diagram and a
  class diagram whose text holds `$$…$$` and then a `<video>` and an `<img>`
  (laid out, and refused for the HTML label, with the same line); the flowchart
  image shape with a URL on another origin (not drawn, with a reason); a class
  diagram with `style A background:url(…)`, a state diagram with a `classDef`
  holding `background:url(…)`, a sequence diagram with a participant `icon`
  property, and a C4 diagram with `UpdateElementStyle(a, $bgColor="url(//…)")`,
  each on another origin (all four drawn, with no reason, so a parse error did
  not stop them); and a flowchart under a directive setting `themeCSS`, and one
  setting `fontFamily`, each with a `url()` on another origin (drawn, as the
  plain flowchart).
  Across them all: no flag was set on `window`, no dialog opened, each figure
  holds only its image (in its box), its `<details>` and, when not drawn, its
  reason line, the first paragraph keeps its computed position and display, the
  body its computed position, and nothing covers the page's corner. And, from
  listeners in place before the page's own script:
  - Nothing left for another origin. Every request to one, of any kind, is
    caught on the network side and aborted, and the list is empty.
  - No element of the author's choosing was in the page while a diagram was
    laid out. A `MutationObserver` records every HTML element added where
    Mermaid lays out (the `div` it adds to `<body>`, and the one it measures
    maths in) other than a bare `div`, `span`, `br` or `style`, which are the
    ones Mermaid's own code makes. The list is empty.
  - The policy refused exactly five things, all `img-src`: the image shape's
    URL, the class style line's, the state `classDef`'s, the participant's icon
    and the C4 colour (`http://attacker.example/b.svg`, since `//` takes the
    page's scheme). Those are the four rows of "What B does not cover" for which
    the policy is the only guard, and the test shows it holding. The
    `themeCSS` and `fontFamily` URLs were never tried. The sankey's `linkColor`
    is not in the test: it is shown, in the script, to change nothing.
  What this test cannot see. It runs in Chromium, on the inputs it holds. A
  URL on this origin in the image shape or a style line is loaded, and the test
  does not try one. This once said an image request the policy blocks "never
  appears as a request"; in Chromium it does appear to the page's request
  listener, though it never reaches the network, and the test now uses that to
  list what was tried.
- The open page sent its document again (a tree change's `router.refresh()`):
  with the same source the image keeps its URL, so nothing was drawn; after an
  edit through the API the diagram is drawn from the new source; and the page
  is not reloaded.
- A comment on the source: open `Source`, select, comment, reload, choose the
  thread; the disclosure opens and the quote is selected.
- The same for a quote inside an author's `<details>`.
- A document with a diagram, opened in the rendered editor and saved without a
  change: the fence is the same bytes, and the reader still draws it.

## Documents changed with the code

- `CLAUDE.md`: the reader invariant gains the diagram rule (drawn as an image,
  never as markup; do not switch to `innerHTML` to make text selectable) and
  the three lists that guard layout; the script invariant's `img-src 'self'`
  becomes `img-src 'self' blob:`, beside `media-src 'none'`.
- `frontend-design-language.md` §8: "Diagrams in a document".
- `README.md`: a row in "Current canonical documents".
- `2026-09-29-personal-daily-driver-design.md` §2: a note that Mermaid is no
  longer deferred, pointing here. The original line stays.
- `2026-10-12-content-security-policy-design.md`: a note on `blob:`, and one on
  `media-src`, pointing here.
- `README.md`: "Mermaid version", under "Development and testing".

## Not in this change

- Drawing in the rendered editor, or a live preview while writing.
- Comments on the picture.
- Saving a diagram as a file; zoom and pan.
- Drawing on the server. It needs a browser there.
- Other diagram languages (PlantUML, Graphviz) and maths.
- The user guide. It gets a section when this ships, as its own change.
- Maths in a diagram (`$$…$$`).
- A `default-src` in the policy, and laying out in a sandboxed frame ("What B
  does not cover").
- Any engine but Chromium, for everything said here about layout.
