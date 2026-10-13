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

- Chunks fetched for a page with one flowchart: 10 files, 665,482 bytes of response body as transferred (gzip; `response.request().sizes().responseBodySize`, headers not included: 4,233 bytes more), 2,326,262 bytes once decoded. The largest is one of 434,116 bytes transferred (1,448,145 decoded). Two runs gave the same total. "Fetched only for a diagram" means: the JavaScript files under `/_next/` the flowchart document fetched that two documents without a `mermaid` block (one with a `js` code block, one text only) did not. The flowchart document fetched 41 JavaScript files, the other two 31 each.
- A page with no `mermaid` block: none of those ten files requested, in either document.
- Opened at a heading below a diagram (`#landing-heading`, a flowchart, 40 filler paragraphs, then the heading; viewport 1280 by 800): lands on the heading. Sampled on every animation frame from navigation: the heading's `getBoundingClientRect().top` was 16 px from the frame in which the page had scrolled to it to the end of the sampling (several seconds), including the frame in which the source closed and the 184 px image appeared. The document's scroll pane moved to compensate (scrollTop 3016, then 2910, then 3132), which is the browser's scroll anchoring; the heading did not move. The same document with the fence changed to `text` (nothing drawn) also had it at 16 px. Not off, so left alone.

## Not measured

- How many stored documents hold a `mermaid` block.
- Browsers other than Chromium. The image approach rests on behaviour all three engines share, and it was run in one. The heading measurement above also depends on Chromium's scroll anchoring, and was not repeated in an engine without it.
- The size of the chunks for any diagram type but a flowchart: other types may load further chunks.
- Time to draw on a slow device. The one figure seen is from a fast machine: an image visible 443 ms after navigation for one flowchart, and ten diagrams settled in about 1.1 s (Task 6 run).
