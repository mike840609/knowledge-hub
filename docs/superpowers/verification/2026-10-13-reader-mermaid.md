# Mermaid in the reader: verification

Spec: `../specs/2026-10-13-reader-mermaid-design.md`.

## What was assumed of Mermaid

Installed: `mermaid@12.2.0`.
`node scripts/test/mermaid-assumptions.mjs`, 2026-10-13:

```json
{
  "types": {
    "flowchart": {
      "svgIsString": true,
      "diagramType": "flowchart-v2",
      "viewBox": true,
      "foreignObject": false,
      "loadsAsImage": true
    },
    "sequence": {
      "svgIsString": true,
      "diagramType": "sequence",
      "viewBox": true,
      "foreignObject": false,
      "loadsAsImage": true
    },
    "class": {
      "svgIsString": true,
      "diagramType": "classDiagram",
      "viewBox": true,
      "foreignObject": false,
      "loadsAsImage": true
    },
    "state": {
      "svgIsString": true,
      "diagramType": "stateDiagram",
      "viewBox": true,
      "foreignObject": false,
      "loadsAsImage": true
    },
    "er": {
      "svgIsString": true,
      "diagramType": "er",
      "viewBox": true,
      "foreignObject": false,
      "loadsAsImage": true
    },
    "gantt": {
      "svgIsString": true,
      "diagramType": "gantt",
      "viewBox": true,
      "foreignObject": false,
      "loadsAsImage": true
    },
    "pie": {
      "svgIsString": true,
      "diagramType": "pie",
      "viewBox": true,
      "foreignObject": false,
      "loadsAsImage": true
    },
    "mindmap": {
      "svgIsString": true,
      "diagramType": "mindmap",
      "viewBox": true,
      "foreignObject": false,
      "loadsAsImage": true
    }
  },
  "directiveGaveHtml": false,
  "lateDirectiveGaveHtml": false,
  "frontmatterGaveHtml": false,
  "carried": {
    "directive": {
      "gaveHtml": false
    },
    "lateDirective": {
      "gaveHtml": false
    },
    "frontmatter": {
      "gaveHtml": false
    }
  },
  "rejected": true,
  "leftInPage": 0,
  "refused": []
}
```

The script printed `OK` and exited 0. Mermaid is initialised with
`secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges", "htmlLabels"]`:
the installed 12.2.0 default list plus `htmlLabels`. Without `htmlLabels` in that list, an
`%%{init}%%` directive turned HTML labels on (first run of this script, which exited 1). With it, a
directive before the first line, a directive after it, and YAML frontmatter `config:` each came out
without `<foreignObject>` (`directiveGaveHtml`, `lateDirectiveGaveHtml`, `frontmatterGaveHtml` all
false; none of the three threw).

Diagram types turned away by the `<foreignObject>` rule: none of the eight tried.

## Runs

- `node scripts/test/mermaid-assumptions.mjs`, 2026-10-13: `OK`, exit 0 (the output above).
- `make verify`, 2026-10-13: 192 test files, 2499 unit tests passed; typecheck (`tsc --noEmit`), lint (`eslint .`) and build passed. Exit 0.
- `make test-e2e`, 2026-10-13: 339 passed, 2 skipped, exit 0. Not run again for this record: the numbers are from the build's Task 6 run, which ran the whole suite once after the last product change. The two skipped are `@smoke-personal` tests in `personal-workspace.spec.ts` that the suite skips itself. `zz-mermaid.spec.ts` 7, `zz-mermaid-hostile.spec.ts` 1: 8 of 8 passed.

## Findings from the browser

- **The marker.** The spec first said a marker for a quote in a closed disclosure goes where "a range with no rectangle says". Chromium does report rectangles for text inside a closed `<details>`, laid out as if it were open: the first run of the comment test put the diagram's marker at y=528 for a figure that ended at y=473, and an author's `<details>` (y=485..513) had its marker at y=527. The marker is now placed by the outermost closed disclosure around the quote (`shownTop`, `review-passage-markers.tsx`); `tests/unit/review-marker-position.test.tsx` has six cases. Per the build's Task 6 report, three of the first five failed on the earlier code. The sixth, "outermost of two closed disclosures, not the innermost", was added after review; with `shownTop` changed to stop at the first closed disclosure it failed (received 140, expected 100) while the other five passed.
- **Hostile input.** The hostile document holds ten blocks; nine were drawn (flowchart-v2) and one was not: `classDef evil fill:url(https://example.invalid/x)` is refused by Mermaid's own parser (`Could not draw this diagram: Parse error on line 3:`), and so are `style A fill:url(https://…)` and `background:url(https://…)` when tried alone. For that input "no request left the origin" rests on Mermaid's refusal and on the image rule, not on a drawn diagram. Sequence, class (a label holding `<script>`), pie (a title holding `<img>`), state, ER, gantt and mindmap diagrams were also drawn in a probe; none produced a `<foreignObject>`.
- **Drawn twice.** Before `createDiagramQueue` dropped superseded requests, every diagram in a hydrated production page was drawn twice (the theme store's server value differs from the client's, so the block asks twice). Only the newest request for a block is drawn now; `tests/unit/mermaid-queue.test.ts`, "a drawing nobody is waiting for is not made".

## Measured

Method: a throwaway Playwright spec (not committed) run through the e2e harness on the production build, 2026-10-13, with `command npm run test:e2e -- <the file>`; Chromium; each page in a fresh browser context so nothing was cached.

- Chunks fetched for a page with one flowchart: 10 files, 665,482 bytes of response body as transferred (gzip; `response.request().sizes().responseBodySize`, headers not included: 4,233 bytes more), 2,326,262 bytes once decoded. The largest is one of 434,116 bytes transferred (1,448,145 decoded). Two runs gave the same total. The largest is ELK's: the production build of 2026-10-14 holds a chunk of exactly
1,448,145 bytes, `.next/static/chunks/91dbc596.66eb85067e5182c6.js`, which contains "Eclipse Layout Kernel". A flowchart
loads it by default (see "ELK" below). "Fetched only for a diagram" means: the JavaScript files under `/_next/` the flowchart document fetched that two documents without a `mermaid` block (one with a `js` code block, one text only) did not. The flowchart document fetched 41 JavaScript files, the other two 31 each.
- A page with no `mermaid` block: none of those ten files requested, in either document.
- Opened at a heading below a diagram (`#landing-heading`, a flowchart, 40 filler paragraphs, then the heading; viewport 1280 by 800): lands on the heading. Sampled on every animation frame from navigation: the heading's `getBoundingClientRect().top` was 16 px from the frame in which the page had scrolled to it to the end of the sampling (several seconds), including the frame in which the source closed and the 184 px image appeared. The document's scroll pane moved to compensate (scrollTop 3016, then 2910, then 3132), which is the browser's scroll anchoring; the heading did not move. The same document with the fence changed to `text` (nothing drawn) also had it at 16 px. Not off, so left alone.

## Not measured

- How many stored documents hold a `mermaid` block.
- Browsers other than Chromium. The image approach rests on behaviour all three engines share, and it was run in one. The heading measurement above also depends on Chromium's scroll anchoring, and was not repeated in an engine without it.
- The size of the chunks for any diagram type but a flowchart: other types may load further chunks. A sequence diagram
  was seen not to load ELK's chunk, in the unbundled `dist` the script serves (a probe run for the wave of 2026-10-14,
  not kept: 29 files for the flowchart and 22 for the sequence diagram, in a page that loads nothing else; the
  script records only whether the ELK chunk was fetched); no figure was taken for it in the production build.
- Time to draw on a slow device. The one figure seen is from a fast machine: an image visible 443 ms after navigation for one flowchart, and ten diagrams settled in about 1.1 s (Task 6 run).

## Final review fixes, 2026-10-14

The whole-branch review found one defect, and its fix is below.

**Fixed: a diagram whose source changes in place kept the old picture.** `MermaidBlock` drew in an effect
that depended on the theme alone, and read the source from the page only when that effect ran. When the
server sent other Markdown into the same position while the block stayed mounted, the `<code>` showed the
new source and the `<img>` the old diagram. The effect now also depends on `children`, which is a new
element when the server sends one and not when the block's own state changes.

- `tests/unit/mermaid-block-client.test.tsx`, new, 13 tests: the component's first client-side test, with the
  queue stubbed. Run on the code before the fix, 2 failed and 11 passed: the case that renders the block
  again in place with other source (`draw` was called once, not twice) and the case in which a drawn block's
  new source cannot be drawn (it needs that second `draw`); both are this one defect. After the fix, 13 passed.
- `tests/e2e/zz-mermaid.spec.ts`, one new test: a note with a flowchart is opened, updated through
  `PATCH /api/documents/:id` to a sequence diagram, and the open page is refreshed by a tree change (creating
  a folder ends in `router.refresh()`). On the code before the fix it failed: the `<code>` showed
  `sequenceDiagram` and the image still had the alt `Diagram (flowchart-v2)...`. After the fix it passes, and
  the page was not reloaded (a marker on `window` survived).
- **A switch of revision does not reproduce it.** A first browser test chose `?revision=1` from the History tab
  and passed on the code before the fix: Next keys the page by its search params, so that navigation mounts a
  new block and the stale one never exists. That test was dropped for the one above. The case that does reach
  a mounted block is a refresh.

Also in this wave, tests only: the two e2e policy assertions (`share-link.spec.ts`,
`content-security-policy.spec.ts`) now require the whole directive `img-src 'self' blob:` rather than
containing `img-src 'self'`; `tests/unit/review-marker-position.test.tsx` gains a case for a quote in no
disclosure, so it has seven cases, not the six above.

Runs, 2026-10-14, on the tree after all of the above:

- `vitest run --config vitest.config.ts` (whole unit suite): 193 test files, 2513 tests passed. Exit 0.
- `tsc --noEmit`: exit 0. `eslint .`: exit 0.
- `command npm run test:e2e -- tests/e2e/zz-mermaid.spec.ts tests/e2e/zz-mermaid-hostile.spec.ts tests/e2e/share-link.spec.ts tests/e2e/content-security-policy.spec.ts`
  (production build, the project's harness): 13 passed, exit 0. That is `zz-mermaid.spec.ts` 8,
  `zz-mermaid-hostile.spec.ts` 1, `share-link.spec.ts` 1, `content-security-policy.spec.ts` 3.

What this supersedes, and what it does not:

- Superseded: "192 test files, 2499 unit tests" (now 193 and 2513), and "`zz-mermaid.spec.ts` 7,
  `zz-mermaid-hostile.spec.ts` 1: 8 of 8" (now 8 and 1, with the two policy specs: 13 of 13).
- Not superseded, and not run again: `make test-e2e`, 339 passed, 2 skipped, above. It ran before this wave, so
  it does not cover the change to `mermaid-block.tsx`, the new test, or the two policy assertions as the whole
  suite; only the four files above were run after them. `make verify` (which includes the build) was not run
  again either; unit, `tsc` and `eslint` were run separately, and the production build was made by each e2e run.

## Review fixes, 2026-10-14

A review before merge of pull request #189 found one critical defect, two important ones and a gap in the
hostile test. This section is what was done about each, and what was seen.

### A diagram could fetch from another origin while it was laid out

Reproduced before the fix, on the production build, through `/s/:token` with no sign-in
(`tests/e2e/zz-mermaid-hostile.spec.ts` with its new blocks, run on the code as it was): the list of requests
that left for another origin was not empty.

```text
media https://attacker.example/v.mp4      an architecture-beta block's icon text: <video src=…>
media https://attacker.example/m.mp4      a sequence and a class diagram: $$x^2$$<video src=…>
image https://attacker.example/m.png      the same two: <img src=…>, tried and refused by img-src
image https://attacker.example/shape.png  the flowchart image shape, tried and refused by img-src
image https://attacker.example/themecss.png, font.png   themeCSS and fontFamily in a directive, tried and refused
```

The two `media` lines reached the network: the policy had no `media-src` and has no `default-src`. The `image`
lines were tried and refused by `img-src`; Chromium reports a refused request to the page's request listener,
which is how they are in the list. The second line was not in the review. Text holding `$$…$$` is written as an
HTML label whatever `htmlLabels` says (`hasKatex`, read in 12.2.0), through a sanitiser whose defaults let
`<video>`, `<img>` and `<a>` through, and that reaches sequence and class diagrams, which are drawn. A check of
the source for `$$` would not have closed it: `&dollar;&dollar;x&dollar;&dollar;` in a class label was drawn as
maths too.

After the fix the same test passes: nothing left the origin, no element of the author's choosing was recorded
while a diagram was laid out, and the policy refused exactly two things, both `img-src`: the image shape's URL
and the `url()` in a class diagram's `style` line. (That was the test on that day. The wave of 2026-10-14, below,
added three more and the test now expects five.)

What changed: the type is found by `mermaid.parse` before anything is laid out and only listed types are drawn;
Mermaid's sanitiser is given a configuration that leaves `<br>` (and, as first written, an attribute of it: `data-*`
and `aria-*` survived, until the wave below); `media-src 'none'` in the three
places the policy is written (nothing under `src/` or `public/` plays audio or video, so `'none'` and not
`'self'`); and six more keys in `secure`.

**How the type is found.** Read in `node_modules/mermaid/dist/mermaid.core.mjs`: `parse` calls `addDiagrams()`,
which registers every detector with its lazy loader, then `processAndSetConfigs(text)` and
`Diagram.fromText(code)`. `render` calls the same three, in that order, before it builds anything, and
`Diagram.fromText` is where the type is decided, by `detectType(code.cleaned, getConfig())`: the text with
frontmatter, directives and comments taken off by `preprocessDiagram`, and the config with the directive applied.
So `parse` and `render` decide the type from the same text and the same config. `mermaid.detectType` on the raw
text was not used for the decision: it strips frontmatter and directives by its own expressions, and is empty of
detectors until something has called `addDiagrams()`. The script checks the reading by running: for every sample
of a drawn type, `parse` and `render` named the same type, including a flowchart behind frontmatter and a comment
that both say `architecture-beta`, and the other way round.

### The types, and why

`make test-mermaid-assumptions`, Chromium, `mermaid@12.2.0`, under
`script-src 'self'; img-src 'self' blob:; media-src 'none'; object-src 'none'; base-uri 'self'`. One hundred
layouts over twenty types. For each: `parse` named the type and added no node to the document; `render` drew the
same type; no HTML element was added to the document during layout other than the ones named below, which
Mermaid's own code makes; nothing was left in `<body>`; no request left the origin; the policy refused nothing.
The mindmap's layout engine leaves one `<style>` in `<head>`, read in its source: a fixed rule,
`.__________cytoscape_container { position: relative; }`, added once.
Hostile text was `<video src>`, `<img src onerror>` and `<a href>` on another origin, once as it is and once
after `$$x^2$$`.

| Detector id | Drawn | Layouts | Where the hostile text was put | HTML elements seen, all Mermaid's own |
| --- | --- | --- | --- | --- |
| `flowchart-v2` | yes | 25 | node labels in nine shapes, edge labels, subgraph title, Markdown strings, `@{ label }` and `@{ icon }` shapes, `accTitle`/`accDescr`, frontmatter title, a link's tooltip, `graph`, `look: handDrawn`, a label with an icon | container `div`, `style` |
| `sequence` | yes | 11 | title, participant and actor aliases, messages, notes, `loop`/`alt`/`else`/`par`/`and`/`critical`/`option`/`opt`/`break`/`box` labels, a `link` label, created participants, `textPlacement: fo` | those, and with `$$` the `div#katex-temp` it measures in and a label `div` |
| `classDiagram` | yes | 9 | class labels, members, notes, relation labels, namespace, tooltips, frontmatter title, `accTitle`/`accDescr`, with a `style` line | those, and with `$$` a label `div` and `span` |
| `stateDiagram` | yes | 5 | state descriptions, transition labels, notes, `accTitle`/`accDescr`, both `stateDiagram` and `stateDiagram-v2` | container `div`, `style` |
| `er` | yes | 3 | relation label, attribute comment, entity alias, `accTitle` | the same |
| `gantt` | yes | 3 | title, section, task name, `accTitle` | the same |
| `pie` | yes | 3 | title, slice label | the same |
| `mindmap` | yes | 5 | node text in six shapes, a Markdown string | those, and the layout engine's hidden `div#cy`, its `div` and `canvas` children, and its `style` in `<head>` |
| `timeline` | yes | 3 | title, section, period, events | container `div`, `style` |
| `quadrantChart` | yes | 3 | title, axis labels, quadrant label, point label | the same |
| `gitGraph` | yes | 3 | commit id, message, tag | the same |
| `requirement` | yes | 3 | requirement name and text, element type and docref, relation target | the same |
| `c4` | yes | 3 | title, person, system, boundary, relation labels | the same |
| `sankey` | yes | 3 | node names | the same |
| `xychart` | yes | 3 | title, axis titles, a category | the same |
| `block` | yes | 3 | block labels in two shapes, a nested block, an edge label | the same |
| `kanban` | yes | 3 | column and card text, `assigned` | the same |
| `packet` | yes | 3 | title, field label | the same |
| `radar` | yes | 3 | title, axis label, curve label | the same |
| `treemap` | yes | 3 | node names | the same |
| `architecture` | no | | | Writes icon text through `.html()`. With Mermaid's default sanitiser that put `<p>`, `<video src>`, `<img src>` and `<a href>` in the page; with ours it is text, and the drawing holds a `<foreignObject>` either way |
| `eventmodeling` | no | | | Writes its text through `.html()` with no sanitiser; `b` and `code` elements were seen, and the drawing holds a `<foreignObject>` |
| `journey` | no | | | Its drawing always holds a `<foreignObject>`, so it was refused after layout before and is not laid out now |
| `flowchart-elk`, `info`, `error` | no | | | `parse` names them; not examined. `flowchart-elk` sets `layout: elk` from its first word |
| `---` | no | | | `parse` throws on it, so there is no type |
| `agentflow`, `swimlane`, `treeView`, `ishikawa`, `venn`, `usecase`, `wardley`, `cynefin`, `railroad`, `railroadEbnf`, `railroadAbnf`, `railroadPeg` | no | | | Not examined, and not run by the script |

Refused after layout, among the drawn types, for a `<foreignObject>`: a sequence diagram whose message, note or
`loop` label holds `$$…$$`, a class diagram whose class label or member does, and a sequence diagram whose own
config sets `textPlacement: fo`. In each, the only HTML elements in the page were the wrappers above. Not every
place with `$$…$$` is refused: see "Where `$$…$$` is refused" below.

The script fails without the sanitiser. With `dompurifyConfig` taken out of its `initialize` it exited 1: every
sequence and class sample with `$$` had `video[src][preload], img[src], a[href]` in the page, and the policy
refused an `img-src` and a `media-src` fetch for each.

What the element check is, exactly: a `MutationObserver` on `document`, child list and subtree, installed before
Mermaid is imported. An HTML-namespace element counts as Mermaid's own when its tag is `div`, `span`, `br`,
`style` or `canvas` and its attributes are among `id`, `class`, `style`, `xmlns`, `width`, `height` and
`data-id`; any other is reported and fails the run. The review's wording was "other than Mermaid's own container
`div` and `style`". That is narrower than what Mermaid itself makes (the maths box, the label wrappers, the
mindmap's layout engine), so the check is by tag and attribute name instead. It records every element of a
tag that can fetch (`img`, `video`, `audio`, `source`, `iframe`, `object`, `embed`, `link`, `image` in the HTML
namespace, and so on: any tag not among the five). It does not record an author's `<style>` element, because a bare
`style` is one of the five, or a `style` attribute on a `div`, `span`, `br`, `style` or `canvas`, because `style` is
among the allowed attribute names: those two are how CSS gets in. They are covered by other assertions instead:
in the script by the policy's violation list and the list of requests that left the origin, and in the e2e by the
same two and the list of requests tried.

### What a diagram's own text can no longer set

`secure` gained `themeCSS`, `fontFamily`, `altFontFamily`, `theme`, `themeVariables`, `layout` and
`dompurifyConfig` (and `linkColor`, in the wave of 2026-10-14 below). Read in 12.2.0's `sanitize`: every key in `secure` is deleted from a directive's or
frontmatter's config, and the function calls itself on each object in it, so the list holds at every depth; it is
called on directives only, never on what `initialize` is given. Run: a flowchart drawn with each of the first six
set by a directive and by frontmatter, and with four of them nested under `flowchart`, was the same string as the
flowchart without, fourteen times of fourteen; the policy refused nothing and no further file of Mermaid's was
fetched. (This once went on to say that 12.2.0 registers a loader for ELK and that `layout: elk` did not ask for
it. That was not what was seen: see "ELK" below. The run did show `layout: elk` changing nothing and fetching
nothing, because ELK is the default.) Before the
keys were added the same run exited 1: `theme`, `themeVariables`, `themeCSS` and `fontFamily` each changed the
drawing, and `themeCSS` and `fontFamily` made an `img-src` violation. The theme still follows the page: the e2e
that switches theme and reads the drawing's text colour passes.

Four things remain that only `img-src` stops, all shown by the script and by the hostile test (the last two found
by the re-review of 2026-10-14, below): the flowchart image shape; a `url()` in a `style` or `classDef` line of a
class, state or block diagram (the flowchart parser refuses one); a sequence participant's icon property; and a C4
`UpdateElementStyle` colour. A fifth, a sankey's `linkColor`, is closed by `secure` since that wave. The `secure`
list had, at this point, fourteen keys; it has fifteen now.

### A picture that did not load

Ten diagrams with a link or a non-breaking space (flowchart, class, state and sequence links; a space in
sequence, class, state, gantt and pie text, as U+00A0 and as `#nbsp;`): none loaded as an image as Mermaid wrote
it, and each loaded with `&nbsp;` made `&#160;` and `xmlns:xlink` declared on the root. `tests/e2e/zz-mermaid.spec.ts`,
new test, a flowchart with `click A href` and a sequence diagram with both spaces: failed before the fix (the
image's natural width was 0), passes after.

### A refresh drew every diagram again

`tests/e2e/zz-mermaid.spec.ts`, the refresh test, now refreshes once with the source unchanged and expects the
image to keep its URL. Before the guard it failed: the URL was another one. After, it passes, and the second
refresh, after an edit, still draws the new source. The 6.5 s figure in the spec is the review's measurement, not
repeated here.

### Tests seen to fail first

- `tests/unit/mermaid-queue.test.ts`: the type cases (the file did not load: `DRAWN_TYPES` did not exist); the
  load check and the mending, 7 of 72 failed; the two early refusals.
- `tests/unit/content-security-policy.test.ts`, on `media-src`, and `tests/unit/mermaid-assumptions-lists.test.ts`,
  on the keys the script had and the queue did not.
- `tests/unit/mermaid-block-client.test.tsx`: 3 failed (the same source sent again, before and after the first
  answer, and after a reason). The three cases that passed before the guard pin a part of it each; with that part
  taken out, each failed: the place, "could not be loaded", and a second mount.
- The three e2e runs above, and the assumptions script twice.

### Runs, on the tree after all of the above

- `make verify` (unit, typecheck, lint, build): 194 test files, 2565 tests passed. Exit 0. Run twice, before and
  after the documents of this section were written; the same both times.
- `make test-mermaid-assumptions`: `OK`. Exit 0. Its output is summarised in the table above.
- `make test-e2e`, whole suite, once: 340 passed, 2 skipped, 1 failed. Exit 2. The one that failed is
  `tests/e2e/owner-review.spec.ts:73`, "a discussion that awaits the owner is open beside its passage when the
  document is, in the outline's place": the document pane was wider than its box
  (`pane.scrollWidth <= pane.clientWidth` was false). It failed once in the whole run, and passed when its file was
  run again alone (11 passed, exit 0). The page it opens has no diagram, so Mermaid is not imported there. The cause
  was not established. The re-review of 2026-10-14 reads it as a race in that test: one un-polled measurement, at
  line 103, taken right after a layout change (it failed 440 ms in; the same test passed in two earlier whole runs,
  at 2.0 s). That reading was not tried, and the test is as it was. Every `zz-mermaid*` test, the policy tests and
  the share-link tests passed in the whole run. The two skipped are the two that were skipped before.

### Superseded

- "193 test files, 2513 tests" above: now 194 and 2565.
- "`make test-e2e`, 339 passed, 2 skipped" above, and the note that it was not run again: it was run again, whole,
  on this tree (above: 340 passed, 2 skipped, and one failure that passed when its file was run again).
- "Diagram types turned away by the `<foreignObject>` rule: none of the eight tried." Among the drawn types the
  rule turns away the three inputs named above; `journey`, `architecture` and `eventmodeling` are not laid out.
- The JSON under "What was assumed of Mermaid" is the script's first form. It now prints one entry per type and
  per check; the eight types there are among the twenty.
- "`secure`: … the installed 12.2.0 default list plus `htmlLabels`": plus seven more keys, above.
- "The hostile document holds ten blocks; nine were drawn": eighteen blocks. The ten are as they were. Of the
  eight added the test holds five to a reason and no image (the architecture and event-model blocks, refused
  before layout; the two with `$$`, refused after it; the image shape, whose image the policy refused) and three
  to an image (the class diagram with a `style` line, and the two flowcharts whose config is ignored).

### Not done, not measured

- No `default-src`. No sandboxed frame for layout.
- Chromium only, for every statement in this section.
- A URL on this origin in the image shape or a style line: it loads, as a Markdown image does; not run.
- The types marked "not examined".
- Accessibility items from the review: a keyboard-scrollable picture box, a live region for the reason, `alt` from
  `accTitle`.

## Re-review fixes, 2026-10-14

A second review of the fix wave above (`7e80139..30dce16`) found no critical defect and one important one: three
more layout-time fetches that rest on `img-src` alone and were in no document or test. This section is what was done
about it and its minor findings, and what was seen. Every run is Chromium, `mermaid@12.2.0`.

### What changed

- **`linkColor` is in `secure`.** `%%{init: {"sankey": {"linkColor": "url(https://attacker.example/s.svg#a)"}}}%%`
  reached layout, and only `img-src` stopped the fetch. In the assumptions script a sankey is drawn with that
  directive, and with it as frontmatter: with the key out of `secure` the drawing changed and the policy refused
  `img-src https://attacker.example/s.svg`, for both forms; with it in, the drawing is the same, nothing is refused
  and nothing further is fetched. (The script also carries `linkColor` at the top level of the config, which a
  sankey does not read and which changed nothing either way.) The comparison treats
  `node-N`, `link-N` and `linearGradient-N` as one name, since a sankey numbers them from a counter that outlives a
  drawing (`node-1`, then `node-6`, for the same text). A plain sankey still draws (its entry in the per-type
  samples). The script and `mermaid-queue.ts` hold the same list (`mermaid-assumptions-lists.test.ts`).
- **A superseded request is not laid out.** The newest-request check is repeated after the load of Mermaid and after
  the type is found, before the next step; it was only at the start and after `render`. A request that is dropped
  there returns without giving back the picture the block shows; the request that replaces it does, as before.
  Unit tests, each seen to fail first: two `draw` calls for one block while the load is pending, `render` called
  with `["old", "new"]` and the test expects `["new"]`; `forget` during the load, `["a"]` and expects none; the
  same two during the type check, `["slow", "new"]` and `["slow"]`.
- **`<br>` carries no attribute.** The sanitiser's configuration gains `ALLOW_DATA_ATTR: false` and
  `ALLOW_ARIA_ATTR: false`, in the queue and in the script (the lists test compares the whole configuration, and
  its literal). The script lays out a sequence message and a class label holding `$$x^2$$ a<br data-x=1 aria-label=y title=t>b`:
  with the flags out, both left `br[data-x][aria-label]` in the page and the sequence one had a `<br>` with
  attributes; with them in, the sequence message makes a bare `<br>` and the class label's page holds no element of
  the author's attributes. (The class label is refused afterwards for its `<foreignObject>`; the check is of the
  moment of layout.) `title` was never allowed.
- **The decode check cannot hang the queue.** It is raced with a timer, `DECODE_TIMEOUT_MS` (10 s, beside the other
  limits), which is cleared when the check settles. One that never settles is "did not load": the URL is revoked, the
  reason is the existing `This kind of diagram cannot be drawn here yet.`, and the next diagram is drawn. Unit tests
  with fake timers through the injected `decodes`: nothing revoked at 9,999 ms, refused and revoked at 10,000 ms, the
  next block drawn; no timer left behind whether the check says yes, no or throws; a check that settles after the
  timeout changes nothing. Seen failing first: `DECODE_TIMEOUT_MS` did not exist and the two timed tests timed out.
- **The image policy's cases.** The script's image-policy group and the hostile e2e gain a sequence participant's
  icon (`properties A: {"icon": "https://attacker.example/x.png"}`) and a C4 `UpdateElementStyle(a, $bgColor="url(//attacker.example/b.svg#a)")`.
  Script: each is laid out, drawn (no throw), and refused with one `img-src` violation (`https://attacker.example/x.png`,
  `http://attacker.example/b.svg`, since `//` takes the page's scheme); the check on the violation's prefix now
  accepts `http:` as well as `https:`. With `img-src` widened to those two origins in a copy of the script, all six
  samples of the group failed with "nothing was refused" and six requests left the origin (four `image`, and two
  `other`: the `fill:url()` of the class style and the C4 colour).
- **The hostile e2e's `REMOTE` sample.** It was a flowchart `classDef … fill:url(…)`, which the flowchart parser
  refuses; it proved nothing about `url()`. It is now a state diagram's `classDef evil background:url(https://attacker.example/remote.png)`.
  The test asserts that this one, the class `style`, the participant icon, the C4 colour and the two ignored configs
  are each drawn (an image, no reason, so not a parse error), and that the policy refused exactly five URLs, all
  `img-src`: `shape.png`, `style.png`, `remote.png`, `x.png` and `<page scheme>//attacker.example/b.svg`, and that the
  requests tried are the same five (`image` for four, `other` for the C4 colour). With `REMOTE` put back as the
  flowchart it fails: the figure holds no `img[data-diagram]`. Twenty blocks, not eighteen.
- **`layout` in the script.** `layout: "elk"` is 12.2.0's default and so was a no-op in the script's "ours" cases.
  A `layout: dagre` case is added (directive, frontmatter), and the nested case now sets dagre. With `layout` out of
  `secure` in a copy: `layoutDagre` changed the drawing and fetched `chunks/mermaid.esm.min/dagre-JKPHJXCU.mjs`, by
  directive and by frontmatter, and `nested` changed the drawing. With it in, neither does.

### ELK

Observed, not assumed. 12.2.0's `defaultConfig.layout` is `"elk"`. A page that draws one plain flowchart,
`flowchart LR; A[Start] --> B{Choice}`, fetches `chunks/mermaid.esm.min/elk-7HBNN7NY.mjs`, 1,618,161 bytes in
`node_modules/mermaid/dist` (the script reports it as `layoutEngine.flowchart`); a plain sequence diagram does not
(`layoutEngine.sequence`: no ELK chunk). `elkjs` is 0.9.3, EPL-2.0 (`node_modules/elkjs/package.json`); mermaid is
MIT. In the production build, the largest chunk of the record's measurement, 1,448,145 bytes decoded, is ELK's (a
chunk of that size in this tree's `.next/static/chunks` contains "Eclipse Layout Kernel"). So the earlier sentence
that `layout: elk` "did not ask for" a loader it had registered was not what happens: the baseline flowchart
already loads ELK, because it is the default. In a probe run for this wave (not kept), `%%{init: {"layout":"elk"}}%%`
produced the same drawing as no directive, with `layout` in `secure` and without; `%%{init: {"layout":"dagre"}}%%`
without it produced a different drawing (11,596 characters against 11,204) and fetched one more chunk. What `layout`
in `secure` prevents is a diagram choosing another engine. It does not prevent ELK from loading. The totals in
"Measured" are unchanged and were right: the ten files for one flowchart include the ELK chunk. It is now named
there and in the spec's "Dependency", with its size and licence.

### Where `$$…$$` is refused

The spec said a sequence or class diagram whose text holds `$$…$$` is turned away. A probe for this wave (not kept;
sixteen sources, with the configuration of the queue) found where, and where not:

| Place | `<foreignObject>` (refused) | Drawn |
| --- | --- | --- |
| sequence message, note, `loop` label | yes | no |
| class label, class member | yes | no |
| sequence title, `box` label | no | yes, `$$x^2$$` shown as text |
| class note, generic note, relation label | no | yes, shown as text |
| flowchart label, state description, ER relation | no | yes, shown as text |
| sequence participant alias, actor alias | no | **yes, with that participant's label missing** |

The last row is a known limitation, left: no code was added for it. The spec states it. The re-review's sample,
`participant A as $$x^2$$ hello`, behaves so here with `hello` absent from the drawing as well as the maths.

### Tests seen to fail first

- `tests/unit/mermaid-queue.test.ts` and `tests/unit/mermaid-assumptions-lists.test.ts`: 8 failed before the change
  (the two lists tests on `linkColor` and the sanitiser's literal; the two timers; the four supersession cases),
  86 passed after, in those two files.
- The assumptions script with, in turn, `linkColor` out of `secure`, the two sanitiser flags out, `layout` out of
  `secure`, and `img-src` widened: each exited 1 with the lines above. With none of them: `OK`.
- `tests/e2e/zz-mermaid-hostile.spec.ts` with the old `REMOTE`: failed, as above.

### Runs, on the tree after all of the above

- `make verify`: 194 test files, 2573 tests passed (8 more than before: three for the decode check, five for the
  supersession). Typecheck, lint and build passed. Exit 0.
- `make test-mermaid-assumptions`: `OK`, exit 0. `abroad` and `scriptRefusals` empty.
- `make test-e2e`, whole suite, once: 340 passed, 2 skipped, 1 failed. Exit 2. The one that failed is
  `tests/e2e/mvp-freshness.spec.ts:9`, "freshness preference persists and reminders link to source actions", with
  `SqlError: pool failed to retrieve a connection from pool` caused by `Too many connections` (MariaDB, error
  1040): the database refused the connection, and the test does not touch a diagram. That file run again alone,
  once: 1 passed, exit 0. Why the database had no connection to give was not looked into. `owner-review.spec.ts:73`
  passed in this run (1.9 s), as did every `zz-mermaid*` test, the policy tests and the share-link tests. The two
  skipped are the two that were skipped before. `docs/ui-comparisons` was restored afterwards and is not committed.

### Superseded

- "194 test files, 2565 tests" and the `make test-e2e` line of "Runs, on the tree after all of the above", in "Review
  fixes": the figures of this wave, above, replace them. Where that section says what failed or passed, it is true of
  its tree, not of this one.
- "Two things remain that only `img-src` stops": four, and the sankey's `linkColor` is closed.
- "the policy refused exactly two things" (the hostile test): five.
- "eighteen blocks" in the spec and in "Superseded" above: twenty, with `REMOTE` replaced.
- "`layout: elk` did not ask for it": see "ELK".
- "a configuration that leaves `<br>` and no attribute": true from this wave; before it `data-*` and `aria-*` stayed.
- "which still catches every element that can fetch": it records every tag but a `<style>` element and a `style`
  attribute; see the paragraph on what the element check is.
- The `$$…$$` sentence under the table of types: see "Where `$$…$$` is refused".

### Not done, not measured

- Not in scope and left: the accessibility items, `default-src`, a sandboxed layout frame, Firefox and Safari, refusing
  `$$` in an alias, and `owner-review.spec.ts`.
- The probes for ELK and for `$$…$$` are not in the script (the script records only whether the ELK chunk is fetched,
  and its size); their figures above are from runs whose output is not kept in the repository.
- A URL on this origin in an icon property or a C4 colour was not tried, as for the image shape.
- Whether the C4 and sequence cases are the only further ones: the review ran about eleven hundred layouts and found
  these; the script runs a sample.
