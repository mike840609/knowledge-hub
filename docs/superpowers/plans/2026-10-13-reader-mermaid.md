# Mermaid Diagrams in the Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fenced `mermaid` block is drawn as its diagram in the reader and on a shared page, as an `<img>` and never as markup, and falls back to the code it is today whenever it cannot be drawn.

**Architecture:** The server keeps sending the code block. A client component (`MermaidBlock`) wraps it and asks a page-wide queue (`mermaid-queue.ts`) for a drawing. The queue loads Mermaid by `import()`, draws one block at a time, turns the SVG string into a `blob:` URL, and the block shows it with `<img>` above a `Source` disclosure that holds the unchanged code block. The queue's logic takes its browser pieces as arguments, so it is unit-tested in Node.

**Tech Stack:** Next.js 15 (server components + one client component), `react-markdown`, `mermaid ~12.2`, Vitest (Node environment; jsdom per file), Playwright (Chromium, against the production build).

**Spec:** `docs/superpowers/specs/2026-10-13-reader-mermaid-design.md`. Read it first. This plan argues from it.

## Global Constraints

- The SVG string is never assigned to `innerHTML`, never passed to `dangerouslySetInnerHTML`, never parsed by the page. It goes into a `Blob` and nowhere else.
- No `rehype-raw`, no sanitiser.
- Mermaid config, exactly: `startOnLoad: false`, `securityLevel: "strict"`, `htmlLabels: false`, `suppressErrorRendering: true`, `theme: "base"`. `bindFunctions` is never called.
- Limits: `MAX_DIAGRAM_CHARS = 10_000`, `MAX_DIAGRAMS = 50`.
- Diagram font: `ui-sans-serif, system-ui, sans-serif`.
- Drawn only when the fence's first word is exactly `mermaid`.
- Reason copy, verbatim:
  - `Could not draw this diagram:` + space + first line of Mermaid's message, cut to 200 characters
  - `This diagram is too long to draw.`
  - `Too many diagrams on this page; this one is left as code.`
  - `This kind of diagram cannot be drawn here yet.`
  - `Diagrams could not be loaded.`
- `alt`: ``Diagram (<type>). Its source follows.``
- CSP: `img-src 'self' blob:` in three places, changed together.
- Colour only through `--kh-*` tokens read at draw time. No colour literal in a component.
- Tailwind's default scale names do not exist here (`text-sm`, `rounded`, …). Use the contract's: `text-caption`, `text-body-sm`, `rounded-md`.
- `mermaid` is reached only through `import()`.

**On this machine** (see the memory note on `npm`): bare `npm`, `npx` and `node` fail in non-interactive shells. Start every shell with

```bash
export PATH=/Users/chuntsai/.nvm/versions/node/v24.6.0/bin:$PATH
```

and call tools as `./node_modules/.bin/vitest`, `./node_modules/.bin/tsc`, `./node_modules/.bin/eslint`. Never pipe a test command into `tail` or `head`; print the exit code with `; echo "EXIT=$?"`. A run that printed no test names did not run.

**Branch:** work on `feat/reader-mermaid`, cut from `main`. The current branch (`fix/review-comment-indent`) holds unrelated uncommitted work; do not build on it. The spec and this plan are untracked files in that working tree: carry them to the new branch and commit them first (`docs: spec and plan for mermaid in the reader`).

## File Structure

| File | Responsibility |
| --- | --- |
| `scripts/test/mermaid-assumptions.mjs` (create) | Checks the spec's "Assumed of Mermaid 12" table in a real browser. Kept: it is how an upgrade is checked. |
| `src/components/knowledge/mermaid-queue.ts` (create) | Limits, reasons, the one-at-a-time queue, URL bookkeeping; and the browser pieces it is given in the page (load, tokens, theme subscription). No React. |
| `src/components/knowledge/mermaid-block.tsx` (create) | The client component: figure, image, `Source` disclosure, reason. |
| `src/components/knowledge/markdown-renderer.tsx` (modify) | `ReadingPre` wraps a `mermaid` block. |
| `src/lib/content-security-policy.ts`, `next.config.ts` (modify) | `blob:` in `img-src`. |
| `src/components/knowledge/markdown-image-policy.ts` (modify) | Comment only. |
| `src/components/knowledge/review-selection.ts` (modify) | `focusReviewAnchor` opens enclosing disclosures. |
| `src/components/knowledge/review-passage-markers.tsx` (modify) | A marker for a quote with no box sits beside the nearest ancestor that has one. |
| `tests/unit/mermaid-queue.test.ts`, `tests/unit/mermaid-block.test.tsx` (create) | Queue logic; server HTML of a wrapped block. |
| `tests/unit/content-security-policy.test.ts`, `markdown-image-policy.test.ts`, `composer-bundle.test.ts`, `review-selection.test.tsx`, `code-highlight.test.tsx` (modify) | |
| `tests/e2e/zz-mermaid.spec.ts`, `tests/e2e/zz-mermaid-hostile.spec.ts` (create) | What only a browser can say. |
| `docs/superpowers/verification/2026-10-13-reader-mermaid.md` (create) | Evidence from the runs. |

---

### Task 1: Install Mermaid and check what the spec assumed

Nothing else is built until this passes. If a row fails, do what the spec's table says for that row; where it says "return to this spec", stop and report.

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `scripts/test/mermaid-assumptions.mjs`
- Create: `docs/superpowers/verification/2026-10-13-reader-mermaid.md`

**Interfaces:**
- Produces: the facts Tasks 3 and 4 rely on: `mermaid.render(id, text)` resolves to `{ svg, diagramType }`; the SVG's root carries a `viewBox`; which diagram types come out without `<foreignObject>`.

- [ ] **Step 1: Install, pinned like `highlight.js`**

```bash
npm install --save-prefix='~' mermaid@12.2; echo "EXIT=$?"
grep -n '"mermaid"' package.json
ls node_modules/mermaid/dist | grep -E 'esm\.min\.mjs$'
```

Expected: `"mermaid": "~12.2.0"` (or the newest `12.2.x`) under `dependencies`; and a file named `mermaid.esm.min.mjs`. If that file is not there, find the self-contained browser ESM bundle in `dist/` (it imports only relative chunks, no bare `d3`) and use its name in the script below.

- [ ] **Step 2: Write the check**

`scripts/test/mermaid-assumptions.mjs`:

```js
// Checks, in a real browser and under the production script policy, what
// docs/superpowers/specs/2026-10-13-reader-mermaid-design.md assumes of Mermaid.
// Run after installing or upgrading mermaid:  node scripts/test/mermaid-assumptions.mjs
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const DIST = path.join("node_modules", "mermaid", "dist");
const ORIGIN = "http://mermaid.test";
// No 'unsafe-eval' and no 'unsafe-inline': what a production page allows a script it loaded.
const POLICY = "script-src 'self'; img-src 'self' blob:; object-src 'none'";

const SAMPLES = {
  flowchart: "flowchart LR\n  A[Start] --> B{Choice}\n  B -->|yes| C[Done]",
  sequence: "sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi",
  class: "classDiagram\n  class Animal {\n    +String name\n    +eat()\n  }\n  Animal <|-- Dog",
  state: "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy\n  Busy --> [*]",
  er: "erDiagram\n  CUSTOMER ||--o{ ORDER : places",
  gantt: "gantt\n  dateFormat YYYY-MM-DD\n  section A\n  Task :a1, 2026-01-01, 3d",
  pie: 'pie\n  "A" : 3\n  "B" : 1',
  mindmap: "mindmap\n  root((Root))\n    Left\n    Right",
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.route(`${ORIGIN}/**`, async (route) => {
  const name = new URL(route.request().url()).pathname.slice(1);
  if (name === "") return route.fulfill({ contentType: "text/html", headers: { "Content-Security-Policy": POLICY }, body: "<!doctype html><title>t</title><body></body>" });
  try {
    await route.fulfill({ contentType: "text/javascript", body: await readFile(path.join(DIST, name)) });
  } catch {
    await route.fulfill({ status: 404, body: "" });
  }
});
const refused = [];
page.on("console", (message) => { if (/Content Security Policy|Refused to/i.test(message.text())) refused.push(message.text()); });
await page.goto(`${ORIGIN}/`);

const result = await page.evaluate(async (samples) => {
  const { default: mermaid } = await import("/mermaid.esm.min.mjs");
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", htmlLabels: false, suppressErrorRendering: true, theme: "base", fontFamily: "ui-sans-serif, system-ui, sans-serif" });
  const body = () => document.body.children.length;
  const before = body();
  const types = {};
  for (const [name, text] of Object.entries(samples)) {
    try {
      const out = await mermaid.render(`check-${name}`, text);
      const url = URL.createObjectURL(new Blob([out.svg], { type: "image/svg+xml" }));
      const image = new Image();
      const loaded = await new Promise((resolve) => { image.onload = () => resolve(true); image.onerror = () => resolve(false); image.src = url; });
      types[name] = {
        svgIsString: typeof out.svg === "string",
        diagramType: out.diagramType,
        viewBox: /<svg[^>]*\sviewBox="[^"]+"/.test(out.svg),
        foreignObject: /<foreignObject[\s>]/i.test(out.svg),
        loadsAsImage: loaded,
      };
    } catch (error) {
      types[name] = { threw: String(error).slice(0, 200) };
    }
  }
  // A directive in the source must not undo the configuration.
  const loosened = await mermaid.render("check-init", '%%{init: {"securityLevel": "loose", "htmlLabels": true, "flowchart": {"htmlLabels": true}}}%%\nflowchart LR\n  A["<b>bold</b>"] --> B');
  // A block Mermaid cannot parse must reject, and leave nothing in the page.
  let rejected = false;
  try { await mermaid.render("check-bad", "this is not a diagram"); } catch { rejected = true; }
  return { types, directiveGaveHtml: /<foreignObject[\s>]/i.test(loosened.svg), rejected, leftInPage: body() - before };
}, SAMPLES);

await browser.close();
console.log(JSON.stringify({ ...result, refused }, null, 2));

const core = ["flowchart", "sequence", "class", "state", "er", "gantt", "pie"];
const failures = [
  ...core.filter((name) => !result.types[name]?.svgIsString).map((name) => `${name}: render did not resolve to an svg string`),
  ...core.filter((name) => !result.types[name]?.viewBox).map((name) => `${name}: no viewBox`),
  ...core.filter((name) => result.types[name]?.foreignObject).map((name) => `${name}: foreignObject with htmlLabels off`),
  ...core.filter((name) => !result.types[name]?.loadsAsImage).map((name) => `${name}: does not load as an image`),
  ...(result.directiveGaveHtml ? ["an init directive turned html labels back on"] : []),
  ...(result.rejected ? [] : ["an unparseable block did not reject"]),
  ...(result.leftInPage === 0 ? [] : [`${result.leftInPage} element(s) left in the page`]),
  ...(refused.length === 0 ? [] : ["the script policy refused something (eval?)"]),
];
if (failures.length > 0) { console.error("FAILED\n" + failures.join("\n")); process.exit(1); }
console.log("OK");
```

- [ ] **Step 3: Run it**

```bash
node scripts/test/mermaid-assumptions.mjs; echo "EXIT=$?"
```

Expected: the JSON, then `OK`, `EXIT=0`. If Chromium is missing: `make browsers`, then again.

On `FAILED`, by line, per the spec's table:

| Line | Do |
| --- | --- |
| `render did not resolve…`, `does not load as an image`, `the script policy refused…` | Stop. Report to the user. |
| `foreignObject with htmlLabels off` for a core type | Stop. Report to the user. |
| `an init directive turned html labels back on` | Continue; in Task 3 strip a leading `%%{…}%%` directive before drawing (`source.replace(/^\s*%%\{[\s\S]*?\}%%\s*/, "")`), add a queue test for it, and record it in the spec's table. |
| `element(s) left in the page` | Continue; in Task 4's `load`, after a rejected `render`, remove `document.getElementById(id)` and `document.getElementById("d" + id)`. Record it in the spec's table. |
| `no viewBox` | Stop. Report to the user (the size has nowhere to come from). |

- [ ] **Step 4: Record it**

Create `docs/superpowers/verification/2026-10-13-reader-mermaid.md`:

```markdown
# Mermaid in the reader: verification

Spec: `../specs/2026-10-13-reader-mermaid-design.md`.

## What was assumed of Mermaid

Installed: `mermaid@<version from package-lock.json>`.
`node scripts/test/mermaid-assumptions.mjs`, <date>:

<the JSON the script printed, in a json code block>

Diagram types turned away by the `<foreignObject>` rule: <those in `types` with `foreignObject: true`, or "none of the eight tried">.
```

Fill the three `<…>` from the run. Do not write a value that was not printed.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json scripts/test/mermaid-assumptions.mjs docs/superpowers/verification/2026-10-13-reader-mermaid.md
git commit -m "chore(reader): add mermaid and check what the design assumes of it"
```

---

### Task 2: `blob:` in `img-src`

**Files:**
- Modify: `src/lib/content-security-policy.ts`, `next.config.ts`, `src/components/knowledge/markdown-image-policy.ts`
- Test: `tests/unit/content-security-policy.test.ts`, `tests/unit/markdown-image-policy.test.ts`

**Interfaces:**
- Produces: a page whose policy lets an `<img>` load a `blob:` URL.

- [ ] **Step 1: Change the tests first**

In `tests/unit/content-security-policy.test.ts`, replace the test named `keeps the image lockdown (issue #20), and shuts plugins and <base>` with:

```ts
  it("keeps the image lockdown (issue #20) but for images this origin's own script made, and shuts plugins and <base>", () => {
    // `blob:` is the drawn diagram (reader-mermaid spec): a URL only script here can mint, and a document cannot name.
    expect(policy["img-src"]).toEqual(["'self'", "blob:"]);
    expect(policy["object-src"]).toEqual(["'none'"]);
    expect(policy["base-uri"]).toEqual(["'self'"]);
  });

  it("says the same about images on a shared page, and where the middleware does not run", async () => {
    const shared = directives(contentSecurityPolicy({ nonce: "n", pathname: "/s/0b1c2d3e-0000-4000-8000-000000000000", development: false }));
    expect(shared["img-src"]).toEqual(["'self'", "blob:"]);
    // next.config.ts writes the directive twice more; a change in one place only is lost on some responses.
    const { default: config } = await import("../../next.config");
    const values = (await config.headers!()).flatMap((rule) => rule.headers).filter((header) => header.key === "Content-Security-Policy").map((header) => header.value);
    expect(values).toHaveLength(2);
    for (const value of values) expect(directives(value)["img-src"]).toEqual(["'self'", "blob:"]);
  });
```

In `tests/unit/markdown-image-policy.test.ts`, add inside its top-level `describe` (if a case for `blob:` is already there, leave it and skip this addition):

```ts
  it("still refuses a blob: URL a document names, though the policy now loads the ones the page makes", () => {
    expect(isAllowedMarkdownImageSrc("blob:http://127.0.0.1:3000/0b1c2d3e-0000-4000-8000-000000000000", { origin: "http://127.0.0.1:3000" })).toBe(false);
  });
```

(Use the import name the file already uses for `isAllowedMarkdownImageSrc`.)

- [ ] **Step 2: Run, and see the two policy tests fail**

```bash
./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/content-security-policy.test.ts tests/unit/markdown-image-policy.test.ts; echo "EXIT=$?"
```

Expected: 2 failures, both on `img-src` (`["'self'"]` received). The image-policy test passes already. `EXIT=1`.

- [ ] **Step 3: Change the three places**

`src/lib/content-security-policy.ts`: in the doc comment replace the paragraph that begins `` `img-src 'self'` is issue #20's `` with

```ts
 * `img-src 'self' blob:` is issue #20's: a remote image URL that ever reached markup is not loaded.
 * `blob:` is for a drawn diagram (reader-mermaid spec): such a URL is minted only by script already
 * running here, and a document cannot name one (`markdown-image-policy.ts` refuses the scheme).
 * A shared page, which needs no sign-in, may not be framed (share-link spec §6.4).
```

and in the body change `"img-src 'self'"` to `"img-src 'self' blob:"`.

`next.config.ts`: change both values, `"img-src 'self'"` → `"img-src 'self' blob:"` and `"img-src 'self'; frame-ancestors 'none'"` → `"img-src 'self' blob:; frame-ancestors 'none'"`. In the comment above `headers()`, change the sentence ``` `img-src 'self'` allows only same-origin / relative images (data: intentionally not allowed).``` to ``` `img-src 'self' blob:` allows only same-origin / relative images, and the diagrams the page itself draws (data: intentionally not allowed).```

`src/components/knowledge/markdown-image-policy.ts`: in the comment, change `` restrictive `img-src 'self'` `` to `` restrictive `img-src 'self' blob:` `` and append to that paragraph: ``` `blob:` there is for diagrams the page draws; this function still refuses it from a document.```

- [ ] **Step 4: Run, and see them pass**

Same command. Expected: all pass, `EXIT=0`.

- [ ] **Step 5: Find other places that pin the old string**

```bash
grep -rn "img-src 'self'" src tests next.config.ts | grep -v "blob:"
```

Expected: only prose that is still true (for example the `globals.css` comment about the chevron mask, and `tests/e2e/content-security-policy.spec.ts`'s `toContain("img-src 'self'")`, which still holds). Change nothing that is still true.

- [ ] **Step 6: Commit**

```bash
git add src/lib/content-security-policy.ts next.config.ts src/components/knowledge/markdown-image-policy.ts tests/unit/content-security-policy.test.ts tests/unit/markdown-image-policy.test.ts
git commit -m "feat(csp): let a page show an image its own script made (blob:)"
```

---

### Task 3: The queue

**Files:**
- Create: `src/components/knowledge/mermaid-queue.ts`
- Test: `tests/unit/mermaid-queue.test.ts`

**Interfaces:**
- Produces, all exported from `mermaid-queue.ts`:

```ts
export const MAX_DIAGRAM_CHARS = 10_000;
export const MAX_DIAGRAMS = 50;
export const DIAGRAM_FONT = "ui-sans-serif, system-ui, sans-serif";
export const DIAGRAM_REASONS: { unparsed: string; long: string; many: string; unsupported: string; unloaded: string };
export type Drawing = { url: string; type: string; width: number; height: number };
export type DiagramOutcome = { drawn: Drawing } | { reason: string };
export type DiagramEngine = { render(id: string, source: string): Promise<{ svg: string; diagramType: string }> };
export type DiagramDeps = { load(): Promise<DiagramEngine>; toUrl(svg: string): string; revoke(url: string): void; pause(): Promise<void> };
export function createDiagramQueue(deps: DiagramDeps): {
  /** `key` is the block (any object, one per block); `index` is its place among the page's diagrams, from 0. */
  draw(key: object, index: number, source: string): Promise<DiagramOutcome>;
  /** The block is gone: its URL is revoked and a drawing still in the queue for it makes none. */
  forget(key: object): void;
};
```

(Task 4 adds the browser pieces to the same file.)

- [ ] **Step 1: Write the tests**

`tests/unit/mermaid-queue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createDiagramQueue, DIAGRAM_REASONS, MAX_DIAGRAM_CHARS, MAX_DIAGRAMS, type DiagramDeps, type DiagramEngine } from "@/components/knowledge/mermaid-queue";

const svg = (body = "", box = "0 0 120.4 60") => `<svg id="x" width="100%" xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${body}</svg>`;

/** The queue with everything a browser would give it replaced, and a record of what it asked for. */
function harness(render: DiagramEngine["render"] = async () => ({ svg: svg(), diagramType: "flowchart-v2" }), load?: DiagramDeps["load"]) {
  const log: string[] = [];
  let made = 0;
  let loads = 0;
  const queue = createDiagramQueue({
    load: load ?? (async () => { loads++; return { render: async (id, source) => { log.push(`render ${source}`); const out = await render(id, source); log.push(`done ${source}`); return out; } }; }),
    toUrl: (text) => { const url = `blob:${++made}`; log.push(`url ${url} ${text.length}`); return url; },
    revoke: (url) => { log.push(`revoke ${url}`); },
    pause: async () => { log.push("pause"); },
  });
  return { queue, log, loads: () => loads };
}

describe("a block that is drawn", () => {
  it("becomes a URL, with the type Mermaid names and the size its viewBox gives, rounded up", async () => {
    const { queue } = harness();
    expect(await queue.draw({}, 0, "flowchart LR\nA-->B")).toEqual({ drawn: { url: "blob:1", type: "flowchart-v2", width: 121, height: 60 } });
  });

  it("loads Mermaid once, however many blocks there are", async () => {
    const { queue, loads } = harness();
    await Promise.all([queue.draw({}, 0, "a"), queue.draw({}, 1, "b"), queue.draw({}, 2, "c")]);
    expect(loads()).toBe(1);
  });

  it("is drawn alone: one block finishes, the browser gets a turn, and then the next begins", async () => {
    const { queue, log } = harness();
    await Promise.all([queue.draw({}, 0, "a"), queue.draw({}, 1, "b")]);
    expect(log.filter((line) => !line.startsWith("url"))).toEqual(["render a", "done a", "pause", "render b", "done b", "pause"]);
  });
});

describe("a block that is not drawn says why, and is left as it was", () => {
  it("too long: not even tried", async () => {
    const { queue, log, loads } = harness();
    expect(await queue.draw({}, 0, "x".repeat(MAX_DIAGRAM_CHARS + 1))).toEqual({ reason: DIAGRAM_REASONS.long });
    expect(await queue.draw({}, 0, "x".repeat(MAX_DIAGRAM_CHARS))).toHaveProperty("drawn");
    expect(log.filter((line) => line.startsWith("render"))).toHaveLength(1);
    expect(loads()).toBe(1);
  });

  it("the 51st on the page: not even tried", async () => {
    const { queue } = harness();
    expect(await queue.draw({}, MAX_DIAGRAMS - 1, "a")).toHaveProperty("drawn");
    expect(await queue.draw({}, MAX_DIAGRAMS, "a")).toEqual({ reason: DIAGRAM_REASONS.many });
  });

  it("Mermaid cannot parse it: the first line of what it said, and no more than 200 characters of it", async () => {
    const { queue } = harness(async () => { throw new Error(`Parse error on line 2:\n...A --x\n${"-".repeat(500)}`); });
    expect(await queue.draw({}, 0, "bad")).toEqual({ reason: `${DIAGRAM_REASONS.unparsed} Parse error on line 2:` });
    const long = harness(async () => { throw new Error("e".repeat(500)); });
    const outcome = await long.queue.draw({}, 0, "bad");
    expect(outcome).toEqual({ reason: `${DIAGRAM_REASONS.unparsed} ${"e".repeat(200)}` });
  });

  it("what is thrown is not an Error: said all the same", async () => {
    const { queue } = harness(async () => { throw "plain string"; });
    expect(await queue.draw({}, 0, "bad")).toEqual({ reason: `${DIAGRAM_REASONS.unparsed} plain string` });
  });

  it.each([
    ["a foreignObject", svg("<g><foreignObject width='10' height='10'><div>x</div></foreignObject></g>")],
    ["a foreignObject in other case", svg("<FOREIGNOBJECT></FOREIGNOBJECT>")],
    ["no viewBox", "<svg xmlns='http://www.w3.org/2000/svg'></svg>"],
    ["a viewBox of no size", svg("", "0 0 0 0")],
  ])("the drawing holds %s: refused, and no URL is made of it", async (_name, text) => {
    const { queue, log } = harness(async () => ({ svg: text, diagramType: "mindmap" }));
    expect(await queue.draw({}, 0, "a")).toEqual({ reason: DIAGRAM_REASONS.unsupported });
    expect(log.some((line) => line.startsWith("url"))).toBe(false);
  });

  it("Mermaid could not be loaded: said, and tried again for the next block", async () => {
    let attempts = 0;
    const { queue } = harness(undefined, async () => {
      if (++attempts === 1) throw new Error("chunk failed");
      return { render: async () => ({ svg: svg(), diagramType: "pie" }) };
    });
    expect(await queue.draw({}, 0, "a")).toEqual({ reason: DIAGRAM_REASONS.unloaded });
    expect(await queue.draw({}, 1, "b")).toHaveProperty("drawn");
  });

  it("does not stop the blocks after it", async () => {
    const { queue } = harness(async (_id, source) => { if (source === "bad") throw new Error("no"); return { svg: svg(), diagramType: "pie" }; });
    const [first, second, third] = await Promise.all([queue.draw({}, 0, "a"), queue.draw({}, 1, "bad"), queue.draw({}, 2, "c")]);
    expect(first).toHaveProperty("drawn");
    expect(second).toHaveProperty("reason");
    expect(third).toHaveProperty("drawn");
  });
});

describe("the URLs it makes", () => {
  it("are given back when the block is drawn again", async () => {
    const { queue, log } = harness();
    const block = {};
    await queue.draw(block, 0, "a");
    await queue.draw(block, 0, "a");
    expect(log.filter((line) => /^(url|revoke)/.test(line)).map((line) => line.split(" ").slice(0, 2).join(" "))).toEqual(["url blob:1", "revoke blob:1", "url blob:2"]);
  });

  it("are given back when the block is drawn again and this time cannot be", async () => {
    let fail = false;
    const { queue, log } = harness(async () => { if (fail) throw new Error("no"); return { svg: svg(), diagramType: "pie" }; });
    const block = {};
    await queue.draw(block, 0, "a");
    fail = true;
    await queue.draw(block, 0, "a");
    expect(log).toContain("revoke blob:1");
  });

  it("are given back when the block goes", async () => {
    const { queue, log } = harness();
    const block = {};
    await queue.draw(block, 0, "a");
    queue.forget(block);
    queue.forget(block);
    expect(log.filter((line) => line.startsWith("revoke"))).toEqual(["revoke blob:1"]);
  });

  it("are not made for a block that went while it waited", async () => {
    const { queue, log } = harness();
    const block = {};
    const waiting = queue.draw(block, 0, "a");
    queue.forget(block);
    expect(await waiting).toHaveProperty("reason");
    expect(log.some((line) => line.startsWith("url"))).toBe(false);
  });

  it("are made again for a block that went and came back (React's strict mode mounts twice)", async () => {
    const { queue } = harness();
    const block = {};
    queue.forget(block);
    expect(await queue.draw(block, 0, "a")).toHaveProperty("drawn");
  });

  it("one block's are not another's", async () => {
    const { queue, log } = harness();
    const a = {}, b = {};
    await queue.draw(a, 0, "a");
    await queue.draw(b, 1, "b");
    queue.forget(a);
    expect(log.filter((line) => line.startsWith("revoke"))).toEqual(["revoke blob:1"]);
  });
});
```

- [ ] **Step 2: Run, and see it fail**

```bash
./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/mermaid-queue.test.ts; echo "EXIT=$?"
```

Expected: fails to resolve `@/components/knowledge/mermaid-queue`. `EXIT=1`.

- [ ] **Step 3: Write the queue**

`src/components/knowledge/mermaid-queue.ts`:

```ts
/**
 * What one diagram, and one document, may cost the tab that opened it (reader-mermaid spec, "When
 * a block is not drawn"). A drawing cannot be interrupted — Mermaid needs the DOM, so it cannot
 * run in a worker — and a shared page has no sign-in in front of it.
 */
export const MAX_DIAGRAM_CHARS = 10_000;
export const MAX_DIAGRAMS = 50;

/**
 * An image cannot use a font the page loaded. Measuring in the product's and drawing in the
 * system's would clip the labels, so a diagram is measured and drawn in the system's.
 */
export const DIAGRAM_FONT = "ui-sans-serif, system-ui, sans-serif";

export const DIAGRAM_REASONS = {
  unparsed: "Could not draw this diagram:",
  long: "This diagram is too long to draw.",
  many: "Too many diagrams on this page; this one is left as code.",
  unsupported: "This kind of diagram cannot be drawn here yet.",
  unloaded: "Diagrams could not be loaded.",
};

export type Drawing = { url: string; type: string; width: number; height: number };
export type DiagramOutcome = { drawn: Drawing } | { reason: string };
export type DiagramEngine = { render(id: string, source: string): Promise<{ svg: string; diagramType: string }> };
/** What the queue needs of a browser, handed to it so that its rules can be read without one. */
export type DiagramDeps = { load(): Promise<DiagramEngine>; toUrl(svg: string): string; revoke(url: string): void; pause(): Promise<void> };

const MAX_REASON_CHARS = 200;

function said(error: unknown): string {
  return String(error instanceof Error ? error.message : error).split("\n")[0].slice(0, MAX_REASON_CHARS);
}

/** The size the drawing asks for, from its root's `viewBox`; `null` when it gives none. */
function sizeOf(svg: string): { width: number; height: number } | null {
  const box = /<svg[^>]*\sviewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg);
  if (!box) return null;
  const width = Math.ceil(Number(box[1])), height = Math.ceil(Number(box[2]));
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Draws the page's diagrams one at a time, in the order they ask, and keeps the URL each one is
 * shown from. The SVG Mermaid returns goes into `toUrl` and nowhere else: it is never parsed by
 * the page. Everything it declines is an outcome with a reason, never a throw.
 */
export function createDiagramQueue(deps: DiagramDeps) {
  let engine: Promise<DiagramEngine> | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let serial = 0;
  const urls = new Map<object, string>();
  const gone = new WeakSet<object>();

  function release(key: object) {
    const url = urls.get(key);
    if (url === undefined) return;
    urls.delete(key);
    deps.revoke(url);
  }

  async function render(source: string): Promise<{ svg: string; type: string; width: number; height: number } | { reason: string }> {
    let loaded: DiagramEngine;
    try {
      loaded = await (engine ??= deps.load());
    } catch {
      // Not kept: the next block asks again, in case it was the network.
      engine = undefined;
      return { reason: DIAGRAM_REASONS.unloaded };
    }
    let result: { svg: string; diagramType: string };
    try {
      result = await loaded.render(`kh-diagram-${++serial}`, source);
    } catch (error) {
      return { reason: `${DIAGRAM_REASONS.unparsed} ${said(error)}` };
    }
    const size = sizeOf(result.svg);
    // HTML inside an SVG draws unevenly as an image; a picture with its labels missing is worse than code.
    if (!size || /<foreignObject[\s>]/i.test(result.svg)) return { reason: DIAGRAM_REASONS.unsupported };
    return { svg: result.svg, type: result.diagramType, ...size };
  }

  async function one(key: object, source: string): Promise<DiagramOutcome> {
    const result = await render(source);
    release(key);
    if ("reason" in result) return result;
    if (gone.has(key)) return { reason: DIAGRAM_REASONS.unsupported };
    const url = deps.toUrl(result.svg);
    urls.set(key, url);
    return { drawn: { url, type: result.type, width: result.width, height: result.height } };
  }

  return {
    draw(key: object, index: number, source: string): Promise<DiagramOutcome> {
      gone.delete(key);
      if (index >= MAX_DIAGRAMS) return Promise.resolve({ reason: DIAGRAM_REASONS.many });
      if (source.length > MAX_DIAGRAM_CHARS) return Promise.resolve({ reason: DIAGRAM_REASONS.long });
      const job = tail.then(() => one(key, source));
      // `one` does not reject; the pause is the browser's turn between two drawings.
      tail = job.then(deps.pause);
      return job;
    },
    forget(key: object) {
      gone.add(key);
      release(key);
    },
  };
}
```

If Task 1 said an init directive turned HTML labels back on, add the strip at the top of `one` and its test, as that task's table says.

- [ ] **Step 4: Run, and see it pass**

Same command. Expected: every test named above passes, `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/components/knowledge/mermaid-queue.ts tests/unit/mermaid-queue.test.ts
git commit -m "feat(reader): a queue that draws a page's diagrams one at a time, within limits"
```

---

### Task 4: The block, in the reader

**Files:**
- Modify: `src/components/knowledge/mermaid-queue.ts` (append the browser pieces)
- Create: `src/components/knowledge/mermaid-block.tsx`
- Modify: `src/components/knowledge/markdown-renderer.tsx`
- Test: `tests/unit/mermaid-block.test.tsx` (create), `tests/unit/composer-bundle.test.ts`, `tests/unit/code-highlight.test.tsx`

**Interfaces:**
- Consumes: `createDiagramQueue`, `DIAGRAM_FONT`, `DiagramOutcome` (Task 3); `codeAsWritten` from `copy-code-button.tsx`; `ScrollablePre` from `markdown-base.tsx`.
- Produces: `diagrams()`, `subscribeTheme(listener)`, `readTheme()` from `mermaid-queue.ts`; `MermaidBlock({ children })` from `mermaid-block.tsx`. In the page: `figure[data-mermaid]` holding, when drawn, `img[data-diagram]`; always one `details` holding the `[data-code-block]`; when refused, `p[data-diagram-reason]`.

- [ ] **Step 1: Write the server-side tests**

`tests/unit/mermaid-block.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownRenderer } from "@/components/knowledge/markdown-renderer";

const fence = (info: string, code: string) => "```" + info + "\n" + code + "\n```";
const html = (markdown: string) => renderToStaticMarkup(<MarkdownRenderer markdown={markdown} />);
const DIAGRAM = "flowchart LR\n  A[One <b>] --> B";

describe("a mermaid block, as the server sends it", () => {
  const page = html(fence("mermaid", DIAGRAM));

  it("is wrapped for drawing", () => {
    expect(page).toContain("<figure data-mermaid");
  });

  it("is still the code block it was: the code as text, where a comment finds it, with its copy button", () => {
    expect(page).toContain("data-code-block");
    expect(page).toMatch(/<code[^>]*data-review-path="0"[^>]*>flowchart LR\n {2}A\[One &lt;b&gt;\] --&gt; B\n<\/code>/);
    expect(page).toContain('aria-label="Copy code"');
  });

  it("reads as that code block before any script runs: the disclosure is open and its summary is not shown", () => {
    expect(page).toMatch(/<details[^>]*\sopen=""/);
    expect(page).toMatch(/<summary[^>]*class="[^"]*\bhidden\b/);
  });

  it("holds no picture, no reason and no markup of the author's", () => {
    expect(page).not.toContain("<img");
    expect(page).not.toContain("data-diagram-reason");
    expect(page).not.toContain("<svg");
    expect(page).not.toContain("<b>");
  });

  it("is wrapped wherever a code block can be", () => {
    for (const markdown of [`- item\n\n  ${fence("mermaid", "pie").replaceAll("\n", "\n  ")}`, `> ${fence("mermaid", "pie").replaceAll("\n", "\n> ")}`, `<details>\n<summary>More</summary>\n\n${fence("mermaid", "pie")}\n\n</details>`]) {
      expect(html(markdown), markdown).toContain("<figure data-mermaid");
    }
  });

  it("is told from its fence's first word alone", () => {
    expect(html(fence("mermaid title=flow", "pie"))).toContain("<figure data-mermaid");
  });
});

describe("what is not a mermaid block", () => {
  it.each([["Mermaid"], ["MERMAID"], ["mmd"], ["mermaidjs"], ["js"], [""]])("a fence that says %j", (info) => {
    const page = html(fence(info, "flowchart LR\n  A --> B"));
    expect(page).not.toContain("data-mermaid");
    expect(page).toContain("data-code-block");
  });

  it("an indented block whose text is a diagram", () => {
    expect(html("Text.\n\n    flowchart LR\n      A --> B")).not.toContain("data-mermaid");
  });
});
```

- [ ] **Step 2: Run, and see it fail**

```bash
./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/mermaid-block.test.tsx; echo "EXIT=$?"
```

Expected: the "as the server sends it" tests fail on `<figure data-mermaid`; "what is not" passes. `EXIT=1`.

- [ ] **Step 3: Append the browser pieces to `mermaid-queue.ts`**

At the end of the file:

```ts
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Mermaid's `base` theme, given the product's tokens as they resolve now (design language §8,
 * "Diagrams in a document"). Read at each drawing, so no colour is declared here and a change of
 * theme is a redraw. The background is the page's: the image is transparent.
 */
function themeVariables() {
  const text = token("--kh-text"), line = token("--kh-text-muted"), fill = token("--kh-bg-subtle"), border = token("--kh-border-strong"), note = token("--kh-highlight");
  return {
    fontFamily: DIAGRAM_FONT, background: "transparent",
    primaryColor: fill, secondaryColor: fill, tertiaryColor: fill, mainBkg: fill,
    primaryBorderColor: border, secondaryBorderColor: border, tertiaryBorderColor: border, clusterBorder: border,
    primaryTextColor: text, secondaryTextColor: text, tertiaryTextColor: text, textColor: text, titleColor: text,
    lineColor: line,
    noteBkgColor: note, noteTextColor: text, noteBorderColor: border,
  };
}

const browser: DiagramDeps = {
  // `import()`, so a page with no diagram never fetches Mermaid; tests/unit/composer-bundle.test.ts holds that.
  async load() {
    const { default: mermaid } = await import("mermaid");
    return {
      async render(id, source) {
        // `strict`, and no HTML labels: the two things that guard the moment Mermaid lays the drawing out in this page.
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", htmlLabels: false, suppressErrorRendering: true, theme: "base", themeVariables: themeVariables(), fontFamily: DIAGRAM_FONT });
        // `bindFunctions` is not taken: nothing in a diagram may be clicked.
        const { svg, diagramType } = await mermaid.render(id, source);
        return { svg, diagramType };
      },
    };
  },
  toUrl: (svg) => URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })),
  revoke: (url) => URL.revokeObjectURL(url),
  pause: () => new Promise((resolve) => setTimeout(resolve)),
};

let shared: ReturnType<typeof createDiagramQueue> | undefined;
/** The page's queue. One, so that the diagrams of one document are drawn in turn. */
export const diagrams = () => (shared ??= createDiagramQueue(browser));

const themeListeners = new Set<() => void>();
let themeObserver: MutationObserver | undefined;

/** Tells `listener` when the reader changes theme. One observer for the page, whoever asks. */
export function subscribeTheme(listener: () => void): () => void {
  themeListeners.add(listener);
  if (!themeObserver) {
    themeObserver = new MutationObserver(() => themeListeners.forEach((each) => each()));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  return () => { themeListeners.delete(listener); };
}

export const readTheme = () => document.documentElement.dataset.theme ?? "";
```

If `tsc` rejects `htmlLabels` at the top level of `initialize`'s argument for the installed version, move it to `flowchart: { htmlLabels: false }` **and** keep the top-level meaning by re-running `scripts/test/mermaid-assumptions.mjs` with the same change; it must still print `OK`. If Task 1 said elements were left in the page, add the removal in `render`'s `catch` as that task's table says.

- [ ] **Step 4: Write the component**

`src/components/knowledge/mermaid-block.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { codeAsWritten } from "./copy-code-button";
import { diagrams, readTheme, subscribeTheme, type DiagramOutcome } from "./mermaid-queue";

/**
 * A `mermaid` code block, and its diagram once that is drawn (reader-mermaid spec).
 *
 * `children` is the code block as the server sent it, and it stays where it is whatever happens:
 * a comment is anchored in its text, so it is never moved or made again. Until a drawing arrives —
 * and for good, when there is none — the disclosure it sits in is open and has no heading, and the
 * block reads as the code block it is. Drawn, the disclosure closes and is called `Source`.
 *
 * The diagram is an `<img>`. The SVG is never put into the page as markup: as an image it runs
 * no script, loads nothing, and its styles reach nothing outside it.
 */
export function MermaidBlock({ children }: { children?: ReactNode }) {
  const figure = useRef<HTMLElement>(null);
  const source = useRef<HTMLDetailsElement>(null);
  const wasDrawn = useRef(false);
  const [outcome, setOutcome] = useState<DiagramOutcome | null>(null);
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "");

  useEffect(() => {
    const element = figure.current;
    if (!element) return;
    // Read from the page, as the copy button reads it: a prop would send the code a second time.
    const text = codeAsWritten(element.querySelector("pre")?.textContent ?? "");
    const index = Array.from(document.querySelectorAll("[data-mermaid]")).indexOf(element);
    let stale = false;
    void diagrams().draw(element, index, text).then((result) => {
      if (stale) return;
      const isDrawn = "drawn" in result;
      // Only when it changes: a redraw for a new theme must not close a source the reader opened.
      if (isDrawn !== wasDrawn.current && source.current) source.current.open = !isDrawn;
      wasDrawn.current = isDrawn;
      setOutcome(result);
    });
    return () => { stale = true; };
  }, [theme]);

  useEffect(() => {
    const element = figure.current;
    return () => { if (element) diagrams().forget(element); };
  }, []);

  const drawn = outcome && "drawn" in outcome ? outcome.drawn : null;
  return (
    <figure ref={figure} data-mermaid>
      {drawn && (
        <div className="my-4 w-full overflow-x-auto">
          {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL this page made; next/image has nothing to optimise. */}
          <img data-diagram src={drawn.url} width={drawn.width} height={drawn.height} alt={`Diagram (${drawn.type}). Its source follows.`} className="max-w-none" />
        </div>
      )}
      <details ref={source} open>
        <summary className={drawn ? "kh-focus-ring rounded-md text-body-sm font-medium text-kh-text-muted print:hidden" : "hidden"}>Source</summary>
        {children}
      </details>
      {outcome && "reason" in outcome && (
        <p data-diagram-reason className="-mt-2 mb-4 text-caption text-kh-text-muted">
          {outcome.reason}
        </p>
      )}
    </figure>
  );
}
```

- [ ] **Step 5: Wrap the block in `ReadingPre`**

In `src/components/knowledge/markdown-renderer.tsx`, replace the imports' first line and `ReadingPre`:

```tsx
import { Children, isValidElement, type ReactNode } from "react";
```

(add `import { MermaidBlock } from "./mermaid-block";` beside the other component imports)

```tsx
/** Whether a `<pre>`'s code came from a fence whose first word is exactly `mermaid`. The reader does not guess a language. */
function isMermaid(children: ReactNode): boolean {
  const code = Children.toArray(children).find((child) => isValidElement<{ className?: string }>(child));
  return isValidElement<{ className?: string }>(code) && (code.props.className ?? "").split(/\s+/).includes("language-mermaid");
}

function ReadingPre({ children }: { children?: ReactNode }) {
  const block = <ScrollablePre action={<CopyCodeButton />}>{children}</ScrollablePre>;
  return isMermaid(children) ? <MermaidBlock>{block}</MermaidBlock> : block;
}
```

And in `MarkdownRenderer`'s doc comment, after "a button to copy each block,", add: "a `mermaid` block drawn as its diagram (`mermaid-block.tsx`),".

- [ ] **Step 6: Run the block's tests, and see them pass**

```bash
./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/mermaid-block.test.tsx; echo "EXIT=$?"
```

Expected: all pass, `EXIT=0`. If `open=""` is not how this React version writes the attribute, read the actual markup and match what it writes; do not loosen the assertion to "contains details".

- [ ] **Step 7: Hold the bundle line**

In `tests/unit/composer-bundle.test.ts`, inside the existing `describe`, add:

```ts
  it("does not reach the diagram block, its queue or mermaid at all", () => {
    const allNames = [...full.files].map((file) => path.basename(file));
    for (const forbidden of ["mermaid-block.tsx", "mermaid-queue.ts"]) expect(allNames, forbidden).not.toContain(forbidden);
    expect([...full.packages].filter((name) => /^mermaid(\/|$)/.test(name))).toEqual([]);
  });
```

and after that `describe`, add:

```ts
describe("what the reader sends to the browser for a diagram", () => {
  const entry = path.join("src", "components", "knowledge", "markdown-renderer.tsx");

  it("is really being read: the walk reaches the queue, and through its import() reaches mermaid", () => {
    expect([...reachable(entry).files].map((file) => path.basename(file))).toContain("mermaid-queue.ts");
    expect([...reachable(entry).packages]).toContain("mermaid");
  });

  it("is not mermaid until a diagram asks: no static import reaches it", () => {
    expect([...reachable(entry, false).packages].filter((name) => /^mermaid(\/|$)/.test(name))).toEqual([]);
  });
});
```

In `tests/unit/code-highlight.test.tsx`, the comment `` `mermaid` is not one at all `` stays true (the highlighter still leaves it plain); leave the test as it is.

```bash
./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/composer-bundle.test.ts tests/unit/code-highlight.test.tsx tests/unit/review-selection.test.tsx; echo "EXIT=$?"
```

Expected: all pass, `EXIT=0`. (`review-selection` is run because it renders pages through `MarkdownRenderer`.)

- [ ] **Step 8: Typecheck and lint**

```bash
./node_modules/.bin/tsc --noEmit; echo "EXIT=$?"
./node_modules/.bin/eslint src/components/knowledge tests/unit; echo "EXIT=$?"
```

Expected: `EXIT=0` twice.

- [ ] **Step 9: Commit**

```bash
git add src/components/knowledge/mermaid-queue.ts src/components/knowledge/mermaid-block.tsx src/components/knowledge/markdown-renderer.tsx tests/unit/mermaid-block.test.tsx tests/unit/composer-bundle.test.ts
git commit -m "feat(reader): draw a mermaid block as an image above its source"
```

---

### Task 5: A quote inside a closed disclosure

True of an author's `<details>` today, and of every drawn diagram's `Source` after Task 4.

**Files:**
- Modify: `src/components/knowledge/review-selection.ts` (`focusReviewAnchor`)
- Modify: `src/components/knowledge/review-passage-markers.tsx` (`measure`)
- Test: `tests/unit/review-selection.test.tsx`

**Interfaces:**
- Produces: `focusReviewAnchor` opens every `<details>` around the quote before it scrolls. A marker's `top` is never read from a range that has no rectangle.

- [ ] **Step 1: Write the failing unit test**

In `tests/unit/review-selection.test.tsx`, add `focusReviewAnchor` to the import from `@/components/knowledge/review-selection`, and add at the end of the file:

```tsx
describe("finding a quote that is inside a closed disclosure", () => {
  const markdown = "<details>\n<summary>Outer</summary>\n\n<details>\n<summary>Inner</summary>\n\nA hidden passage.\n\n</details>\n\n</details>";

  test("opens every disclosure around it before going to it", () => {
    const root = page(markdown);
    const paragraph = Array.from(root.querySelectorAll("p")).find((element) => element.textContent === "A hidden passage.")!;
    const text = paragraph.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 2);
    range.setEnd(text, 8);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const anchor = selectedReviewAnchor(root, markdown, selection)!;
    expect(anchor.exact).toBe("hidden");

    const all = Array.from(root.querySelectorAll("details"));
    expect(all).toHaveLength(2);
    for (const each of all) each.open = false;
    // jsdom lays nothing out, so it has no scrolling of its own.
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;

    focusReviewAnchor(root, markdown, anchor);

    expect(all.map((each) => each.open)).toEqual([true, true]);
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(window.getSelection()!.toString()).toBe("hidden");
  });
});
```

- [ ] **Step 2: Run, and see it fail**

```bash
./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/review-selection.test.tsx -t "opens every disclosure"; echo "EXIT=$?"
```

Expected: fails on `expected [ false, false ] to deeply equal [ true, true ]`. `EXIT=1`. If it fails earlier, on `anchor` being `null`, the page helper or the HTML subset does not make the paragraph selectable as assumed: read the neighbouring tests in this file for how they obtain an anchor inside `<details>` and build it the same way; the assertion on `open` is the point and stays.

- [ ] **Step 3: Open them**

In `src/components/knowledge/review-selection.ts`, in `focusReviewAnchor`, between `if (!element) return;` and `element.tabIndex = -1; …`, add:

```ts
  // A quote in a closed disclosure has no box to scroll to: an author's `<details>`, or a diagram's source.
  for (let closed = element.closest("details"); closed; closed = closed.parentElement?.closest("details") ?? null) closed.open = true;
```

- [ ] **Step 4: Run, and see it pass**

Same command, then the whole file:

```bash
./node_modules/.bin/vitest run --config vitest.config.ts tests/unit/review-selection.test.tsx; echo "EXIT=$?"
```

Expected: all pass, `EXIT=0`.

- [ ] **Step 5: Put the marker beside something that has a box**

In `src/components/knowledge/review-passage-markers.tsx`, above the component, add:

```tsx
/**
 * Where a quote is on the page. One inside a closed disclosure has no rectangle of its own — and
 * an empty range reports the top of the viewport, which put its marker wherever that happened to
 * be — so it is placed beside the nearest thing around it that is shown: the disclosure.
 */
function shownTop(range: Range): number {
  const rect = range.getClientRects()[0];
  if (rect) return rect.top;
  let host = range.startContainer.parentElement;
  while (host && host.getClientRects().length === 0) host = host.parentElement;
  return (host ?? document.body).getBoundingClientRect().top;
}
```

and in `measure`, replace

```tsx
        ...group, top: Math.round((range.getClientRects()[0]?.top ?? range.getBoundingClientRect().top) - origin - 2),
```

with

```tsx
        ...group, top: Math.round(shownTop(range) - origin - 2),
```

This has no unit test: jsdom gives every element no rectangles. Task 6's comment test measures it in a browser.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
./node_modules/.bin/tsc --noEmit; echo "EXIT=$?"
./node_modules/.bin/eslint src/components/knowledge/review-selection.ts src/components/knowledge/review-passage-markers.tsx tests/unit/review-selection.test.tsx; echo "EXIT=$?"
git add src/components/knowledge/review-selection.ts src/components/knowledge/review-passage-markers.tsx tests/unit/review-selection.test.tsx
git commit -m "fix(review): a quote inside a closed disclosure is opened when it is found, and its marker sits beside it"
```

---

### Task 6: In a browser

The e2e run builds for production, so there is no `unsafe-eval`: if Mermaid needed it, the first test fails with a refusal in the console.

**Files:**
- Create: `tests/e2e/zz-mermaid.spec.ts`, `tests/e2e/zz-mermaid-hostile.spec.ts`

Both sort last (`zz-`) for the reason `zz-wikilinks-composer.spec.ts` gives: they add documents to My Space, which earlier specs count and lay out.

**Interfaces:**
- Consumes: the page structure Task 4 produces; `createReviewDocument`, `openReviewDiscussions` from `tests/e2e/fixtures/document-review.ts`; `personalWorkspaceId` from `tests/e2e/fixtures/my-space.ts`.

- [ ] **Step 1: Write the main spec**

`tests/e2e/zz-mermaid.spec.ts`:

```ts
import { expect, test, type Locator, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument, openReviewDiscussions } from "./fixtures/document-review";

// docs/superpowers/specs/2026-10-13-reader-mermaid-design.md
// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };
/** Mermaid is fetched, then each block is drawn in turn. */
const DRAWN = { timeout: 20_000 };

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const fence = (code: string, info = "mermaid") => ["```" + info, code, "```"].join("\n");
const FLOW = "flowchart LR\n  A[Start] --> B{Choice}\n  B -->|yes| C[Done]";
const SEQUENCE = "sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi";
const BROKEN = "flowchart LR\n  A[Unclosed --> B";
const MARKDOWN = ["Before.", "", fence(FLOW), "", fence(BROKEN), "", fence(SEQUENCE), "", fence("const a = 1;", "js"), "", "After."].join("\n");

async function createNote(page: Page, title: string, markdown: string) {
  const workspaceId = await mySpace(page);
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  return { url: `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`, documentId: created.documentId };
}

const figures = (page: Page) => page.locator("article figure[data-mermaid]");
const image = (figure: Locator) => figure.locator("img[data-diagram]");
const reason = (figure: Locator) => figure.locator("[data-diagram-reason]");

/** Every diagram on the page has either its picture or its reason. */
async function settled(page: Page) {
  await expect(page.locator("article figure[data-mermaid]:not(:has(img[data-diagram])):not(:has([data-diagram-reason]))")).toHaveCount(0, DRAWN);
}

/** Console lines that say the policy refused something. */
function refusals(page: Page) {
  const refused: string[] = [];
  page.on("console", (message) => { if (/Content Security Policy|Refused to/i.test(message.text())) refused.push(message.text()); });
  return refused;
}

async function expectDrawn(figure: Locator) {
  const picture = image(figure);
  await expect(picture).toBeVisible(DRAWN);
  await expect(picture).toHaveAttribute("src", /^blob:/);
  await expect(picture).toHaveAttribute("alt", /^Diagram \(.+\)\. Its source follows\.$/);
  // Loaded, with a size: the policy let the image in, and it is not an empty picture.
  await expect.poll(() => picture.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0 && element.naturalHeight > 0)).toBe(true);
  await expect(figure.locator("details")).not.toHaveAttribute("open", "");
  await expect(figure.locator("summary")).toHaveText("Source");
}

async function expectReadsAsOnePage(page: Page) {
  await settled(page);
  const all = figures(page);
  await expect(all).toHaveCount(3);

  await expectDrawn(all.nth(0));
  await expectDrawn(all.nth(2));

  // The one Mermaid cannot parse is the code block it was, with why; the one after it was still drawn.
  const broken = all.nth(1);
  await expect(image(broken)).toHaveCount(0);
  await expect(reason(broken)).toHaveText(/^Could not draw this diagram: \S/);
  await expect(broken.locator("pre")).toBeVisible();
  await expect(broken.locator("pre")).toHaveText(/A\[Unclosed --> B/);
  await expect(broken.locator("summary")).toBeHidden();

  // Another language is not a diagram.
  await expect(page.locator("article [data-code-block]")).toHaveCount(4);
  // Nothing of a diagram is in the page as markup.
  await expect(page.locator("article svg, article foreignObject, [id^='kh-diagram'], [id^='dkh-diagram']")).toHaveCount(0);
}

test.describe("mermaid in the reader", () => {
  test("a flowchart and a sequence diagram are drawn, and a block that cannot be is left as code with a reason", async ({ page }) => {
    const refused = refusals(page);
    const note = await createNote(page, unique("Diagrams"), MARKDOWN);
    await page.goto(note.url);
    await expectReadsAsOnePage(page);
    expect(refused).toEqual([]);
  });

  test("the source is one click away, and copies as written", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const note = await createNote(page, unique("Diagram source"), fence(FLOW));
    await page.goto(note.url);
    await settled(page);
    const figure = figures(page).first();
    await expect(figure.locator("pre")).toBeHidden();
    await figure.locator("summary").click();
    await expect(figure.locator("pre")).toBeVisible();
    await figure.getByRole("button", { name: "Copy code" }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(FLOW);
  });

  test("changing theme draws each diagram again, in the new theme's colours, and leaves an opened source open", async ({ page }) => {
    const note = await createNote(page, unique("Diagram theme"), fence(FLOW));
    await page.goto(note.url);
    await settled(page);
    const figure = figures(page).first();
    await figure.locator("summary").click();
    const before = await image(figure).getAttribute("src");
    const pixel = () => image(figure).evaluate(async (element: HTMLImageElement) => {
      // The drawing's own text colour, read from what it is drawn from.
      const text = await (await fetch(element.src)).text();
      return /fill:\s*(#[0-9a-f]{3,8})/i.exec(text)?.[1] ?? "";
    });
    const light = await pixel();
    await page.evaluate(() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; });
    await expect.poll(() => image(figure).getAttribute("src"), DRAWN).not.toBe(before);
    await expect(image(figure)).toHaveAttribute("src", /^blob:/);
    expect(await pixel()).not.toBe(light);
    await expect(figure.locator("details")).toHaveAttribute("open", "");
  });

  test("a diagram wider than the column scrolls sideways in its own box, and the page does not", async ({ page }) => {
    const wide = "flowchart LR\n  " + Array.from({ length: 30 }, (_, index) => `N${index}[Node number ${index}]`).join(" --> ");
    const note = await createNote(page, unique("Wide diagram"), fence(wide));
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(note.url);
    await settled(page);
    const figure = figures(page).first();
    await expect(image(figure)).toBeVisible(DRAWN);
    const box = image(figure).locator("xpath=..");
    expect(await box.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("a document with a diagram, edited in the rendered editor and saved, keeps the fence as written and is still drawn", async ({ page }) => {
    const note = await createNote(page, unique("Diagram edit"), ["Intro line.", "", fence(FLOW), "", "After."].join("\n"));
    await page.goto(`${note.url}/edit`);
    const form = page.locator("main form").first();
    const surface = form.getByRole("textbox", { name: "Content" });
    await expect(surface).toBeEditable(ROUND_TRIP);
    await surface.locator("p").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" (edited)");
    const saved = page.waitForRequest((request) => request.method() === "PATCH" && /\/api\/documents\//.test(request.url()), ROUND_TRIP);
    await form.getByRole("button", { name: "Save" }).click();
    const markdown = (JSON.parse((await saved).postData() ?? "{}") as { markdown?: string }).markdown ?? "";
    expect(markdown).toContain("Intro line. (edited)");
    expect(markdown).toContain(fence(FLOW));
    await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
    await settled(page);
    await expectDrawn(figures(page).first());
  });
});

test.describe("mermaid on a shared page", () => {
  test("is drawn there too, with no sign-in and no refusal", async ({ page, browser }) => {
    const note = await createNote(page, unique("Shared diagrams"), MARKDOWN);
    const shared = await page.request.post(`/api/documents/${note.documentId}/share-links`, { data: { label: "diagrams", expiresInDays: 1 } });
    expect(shared.status()).toBe(201);
    const { link } = (await shared.json()) as { link: { path: string } };

    const anonymous = await browser.newContext();
    const visitor = await anonymous.newPage();
    const refused = refusals(visitor);
    const response = await visitor.goto(new URL(link.path, page.url()).toString());
    expect(response!.headers()["content-security-policy"]).toContain("img-src 'self' blob:");
    await expectReadsAsOnePage(visitor);
    expect(refused).toEqual([]);
    await anonymous.close();
  });
});

test.describe("a comment on a diagram", () => {
  /** Selects `text` inside the first `selector` that holds it. */
  async function selectIn(page: Page, selector: string, text: string) {
    await page.locator("[data-review-document]").evaluate((root, [selector, text]) => {
      const element = Array.from(root.querySelectorAll(selector)).find((candidate) => candidate.textContent!.includes(text));
      if (!element) throw new Error(`"${text}" is not in ${selector}`);
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const start = element.textContent!.indexOf(text), end = start + text.length;
      const range = document.createRange();
      let offset = 0;
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (start >= offset && start < offset + node.length) range.setStart(node, start - offset);
        if (end > offset && end <= offset + node.length) range.setEnd(node, end - offset);
        offset += node.length;
      }
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    }, [selector, text]);
  }

  async function comment(page: Page, body: string) {
    await page.getByRole("button", { name: "Comment on selection" }).filter({ visible: true }).click();
    await page.getByRole("textbox", { name: "Add comment" }).fill(body);
    await page.getByRole("button", { name: "Add comment", exact: true }).click();
    await expect(page.locator("[data-review-thread]").filter({ visible: true }).filter({ hasText: body })).toBeVisible();
  }

  const quote = (page: Page, text: string) => page.locator("[data-review-thread]").filter({ visible: true }).filter({ hasText: text }).locator("blockquote button");

  test("is made on its source, and choosing it later opens the source at the quote", async ({ page, request }) => {
    const doc = await createReviewDocument(request, ["Intro passage.", "", fence(FLOW), "", "<details>", "<summary>More</summary>", "", "A folded passage.", "", "</details>"].join("\n"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
    await openReviewDiscussions(page);
    await settled(page);
    const figure = figures(page).first();
    await expect(image(figure)).toBeVisible(DRAWN);

    // On the diagram's source.
    await figure.locator("summary").click();
    const posted = page.waitForRequest((sent) => sent.url().endsWith("/api/share-review/threads") && sent.method() === "POST");
    await selectIn(page, "figure[data-mermaid] pre code", "B{Choice}");
    await comment(page, "On the diagram");
    expect((await posted).postDataJSON().anchor).toMatchObject({ blockKind: "code", exact: "B{Choice}" });

    // And on a passage in the author's own disclosure.
    const folded = page.locator("article details").filter({ hasText: "A folded passage." });
    await folded.locator("summary").click();
    await selectIn(page, "p", "folded");
    await comment(page, "On the folded passage");

    await page.reload();
    await openReviewDiscussions(page);
    await settled(page);
    await expect(page.locator("[data-review-marker]")).toHaveCount(2);

    // Both are closed again; each marker sits beside its closed disclosure, not at the top of the window.
    const source = figures(page).first().locator("details");
    const author = page.locator("article details").filter({ hasText: "More" }).last();
    await expect(source).not.toHaveAttribute("open", "");
    await expect(author).not.toHaveAttribute("open", "");
    for (const [marker, host] of [[page.locator("[data-review-marker]").nth(0), figures(page).first()], [page.locator("[data-review-marker]").nth(1), author]] as const) {
      const mark = (await marker.boundingBox())!, box = (await host.boundingBox())!;
      expect(mark.y, "the marker is level with what holds its quote").toBeGreaterThanOrEqual(box.y - 8);
      expect(mark.y).toBeLessThanOrEqual(box.y + box.height);
    }

    // Choosing a quote opens what hides it and selects it.
    await quote(page, "On the diagram").click();
    await expect(source).toHaveAttribute("open", "");
    await expect.poll(() => page.evaluate(() => window.getSelection()!.toString())).toBe("B{Choice}");

    await quote(page, "On the folded passage").click();
    await expect(author).toHaveAttribute("open", "");
    await expect.poll(() => page.evaluate(() => window.getSelection()!.toString())).toBe("folded");
  });
});
```

- [ ] **Step 2: Write the hostile spec**

`tests/e2e/zz-mermaid-hostile.spec.ts`:

```ts
import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// docs/superpowers/specs/2026-10-13-reader-mermaid-design.md, "Tests", hostile.
// On a shared page: the one place a document is read with no sign-in in front of it.
const DRAWN = { timeout: 20_000 };
const fence = (code: string) => ["```mermaid", code, "```"].join("\n");
const LOOSE = '%%{init: {"securityLevel": "loose", "htmlLabels": true, "flowchart": {"htmlLabels": true}}}%%\n';

const HANDLER = 'flowchart LR\n  A["<img src=x onerror=\'window.khPwned=1\'>"] --> B';
const SCRIPT = 'flowchart LR\n  A["<script>window.khPwned=2</script>"] --> B';
const LINK = 'flowchart LR\n  A --> B\n  click A href "javascript:window.khPwned=3"';
const CALLBACK = "flowchart LR\n  A --> B\n  click A call alert()";
const REMOTE = "flowchart LR\n  A --> B\n  classDef evil fill:url(https://example.invalid/x)\n  class A evil";
const COVER = "flowchart LR\n  A --> B\n  classDef evil position:fixed,top:0,left:0,width:100vw,height:100vh\n  class A evil";
const BREAKOUT = 'flowchart LR\n  A["</text></g></svg><img src=x onerror=window.khPwned=4>"] --> B';

const CASES = [HANDLER, LOOSE + HANDLER, SCRIPT, LOOSE + SCRIPT, LINK, LOOSE + LINK, CALLBACK, REMOTE, COVER, BREAKOUT];
const MARKDOWN = ["A first paragraph.", "", ...CASES.flatMap((source) => [fence(source), ""]), "A last paragraph."].join("\n");

async function shareOf(page: Page, markdown: string) {
  const workspaceId = await mySpace(page);
  const made = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title: `Hostile diagrams ${Date.now().toString(36)}`, markdown } });
  expect(made.ok()).toBe(true);
  const { documentId } = (await made.json()) as { documentId: string };
  const shared = await page.request.post(`/api/documents/${documentId}/share-links`, { data: { label: "hostile", expiresInDays: 1 } });
  expect(shared.status()).toBe(201);
  const { link } = (await shared.json()) as { link: { path: string } };
  return new URL(link.path, page.url()).toString();
}

test("no diagram puts an element, a script, a request or a style of its own onto a shared page", async ({ page, browser }) => {
  await page.goto("/");
  const url = await shareOf(page, MARKDOWN);

  const anonymous = await browser.newContext();
  const visitor = await anonymous.newPage();
  const origin = new URL(url).origin;
  const abroad: string[] = [];
  visitor.on("request", (request) => {
    const target = request.url();
    if (!target.startsWith(origin) && !target.startsWith("blob:") && !target.startsWith("data:")) abroad.push(target);
  });
  const dialogs: string[] = [];
  visitor.on("dialog", (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss(); });

  await visitor.goto(url);
  const figures = visitor.locator("article figure[data-mermaid]");
  await expect(figures).toHaveCount(CASES.length);
  // Each has settled one way or the other; which way is Mermaid's business, and either is safe.
  await expect(visitor.locator("article figure[data-mermaid]:not(:has(img[data-diagram])):not(:has([data-diagram-reason]))")).toHaveCount(0, DRAWN);

  // Click where a link or a callback would be.
  for (const picture of await visitor.locator("img[data-diagram]").all()) await picture.click({ position: { x: 20, y: 20 }, force: true });
  expect(visitor.url()).toBe(url);

  const page_ = await visitor.evaluate(() => {
    const allowed = (figure: Element) => Array.from(figure.children).every((child) =>
      (child.tagName === "DIV" && child.children.length === 1 && child.firstElementChild!.tagName === "IMG" && child.firstElementChild!.attributes.length <= 6) ||
      child.tagName === "DETAILS" ||
      (child.tagName === "P" && child.hasAttribute("data-diagram-reason") && child.children.length === 0));
    const first = document.querySelector("article p")!;
    return {
      pwned: (window as unknown as { khPwned?: number }).khPwned ?? null,
      figuresAsBuilt: Array.from(document.querySelectorAll("figure[data-mermaid]")).every(allowed),
      // Nothing of a drawing is in the page: not in the article, and not left behind where Mermaid laid it out.
      strays: document.querySelectorAll("article svg, article script, article style, foreignObject, [id^='kh-diagram'], [id^='dkh-diagram'], img[onerror], body > svg").length,
      imageSources: Array.from(document.querySelectorAll("article img")).map((image) => new URL((image as HTMLImageElement).src).protocol),
      // A style that got out would show here: the first paragraph is still an ordinary one.
      paragraph: { position: getComputedStyle(first).position, display: getComputedStyle(first).display },
      bodyPosition: getComputedStyle(document.body).position,
      // Nothing covers the page: what is at its corner is not a diagram.
      atCorner: document.elementFromPoint(4, 4)?.closest("figure[data-mermaid]") === null,
    };
  });

  expect(page_.pwned).toBeNull();
  expect(dialogs).toEqual([]);
  expect(abroad).toEqual([]);
  expect(page_.figuresAsBuilt).toBe(true);
  expect(page_.strays).toBe(0);
  expect(new Set(page_.imageSources)).toEqual(new Set(["blob:"]));
  expect(page_.paragraph).toEqual({ position: "static", display: "block" });
  expect(page_.bodyPosition).toBe("static");
  expect(page_.atCorner).toBe(true);
  await anonymous.close();
});
```

If `imageSources` is empty because Mermaid refused every case, the `Set` assertion fails — correctly: a hostile spec in which nothing was drawn has not tested the image. In that case add one plain `flowchart LR\n  A --> B` to `CASES` and say so in the verification record.

- [ ] **Step 3: Run both**

```bash
make browsers; echo "EXIT=$?"
npm run test:e2e -- tests/e2e/zz-mermaid.spec.ts tests/e2e/zz-mermaid-hostile.spec.ts; echo "EXIT=$?"
```

Expected: 8 tests pass (7 + 1), `EXIT=0`. If the script does not take file arguments, run `make test-e2e` and read these two files' results in its output.

Known first-run traps, from this repository's notes:
- Documents stuck on "Loading document", or `PROBE-NEXT` lines in the console: a stale build cache. Move `.next/cache` aside and run again. It is not this change.
- A 500 "Database operation failed": an unapplied migration; `make db-migrate`.

What a failure here means:

| Failure | Meaning |
| --- | --- |
| `refused` not empty, mentioning `eval` | Mermaid needs `unsafe-eval`. Stop; report to the user (spec table, last row). |
| `refused` not empty, mentioning `img-src` | Task 2 missed a place. Fix it there. |
| `pixel()` returns `""` in the theme test | The drawing does not write `fill:` in a style. Read one drawing's text and pick the attribute it does write the text colour in; keep the assertion that it differs between themes. |
| Marker `y` outside its host | `shownTop` is not being reached, or the markers are not re-measured after the disclosure closes. The article is observed for size; check the measure runs after reload. |
| Selection is `""` after choosing the diagram's quote | The disclosure opened after the range was resolved. In `focusReviewAnchor`, the opening loop must run before `selection.addRange`. It is written that way in Task 5; check the order. |

- [ ] **Step 4: Run every e2e spec**

Other specs count code blocks and read the policy.

```bash
make test-e2e; echo "EXIT=$?"
```

Expected: everything passes, `EXIT=0`. A spec that asserted the exact string `img-src 'self'` with `toBe`/`toEqual` now fails honestly: update it to `img-src 'self' blob:`.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/zz-mermaid.spec.ts tests/e2e/zz-mermaid-hostile.spec.ts
git commit -m "test(reader): diagrams in a browser, on a shared page, under comment, and against hostile input"
```

---

### Task 7: The documents, and the evidence

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/superpowers/specs/frontend-design-language.md`, `docs/superpowers/specs/2026-09-29-personal-daily-driver-design.md`, `docs/superpowers/specs/2026-10-12-content-security-policy-design.md`, `docs/superpowers/specs/2026-10-13-reader-mermaid-design.md`, `docs/superpowers/verification/2026-10-13-reader-mermaid.md`

- [ ] **Step 1: `CLAUDE.md`, the reader invariant**

At the end of the bullet that begins `**The reader never passes HTML through.**`, after the sentence ending `` `tests/unit/markdown-renderer-html-subset.test.tsx`. ``, add:

```markdown
  A `mermaid` block is drawn the same way round: Mermaid's SVG goes into a `Blob`
  and is shown by `<img>`, never set as markup
  (`docs/superpowers/specs/2026-10-13-reader-mermaid-design.md`). Do not move it to
  `innerHTML` to make its text selectable or its links work; as an image it runs
  nothing and styles nothing, which inline it would. Its hostile cases are
  `tests/e2e/zz-mermaid-hostile.spec.ts`.
```

In the bullet that begins `**Scripts run by nonce.**`, change `` beside `img-src 'self'` and `` to `` beside `img-src 'self' blob:` (the `blob:` is the drawn diagram, minted by this origin's script) and ``.

- [ ] **Step 2: The design language**

In `docs/superpowers/specs/frontend-design-language.md`, add a subsection in §8 between "Syntax colour" and "Chart colour":

```markdown
### Diagrams in a document

A `mermaid` block is drawn by Mermaid's `base` theme, given these and nothing
else, read from the page when the drawing is made
(`mermaid-queue.ts`, `themeVariables`):

| In the diagram | Token |
| --- | --- |
| background | none; the image is transparent and sits on the page |
| node and cluster fill | `--kh-bg-subtle` |
| node and cluster border | `--kh-border-strong` |
| text | `--kh-text` |
| lines and arrowheads | `--kh-text-muted` |
| note fill | `--kh-highlight` |

No token is added for diagrams, and a colour is not written into that
function: it reads tokens. Changing theme draws each diagram again. A colour
the author writes in a diagram (`style A fill:#f00`) is the author's and is
kept, as a colour in an image they attached would be.

The type is the system's (`ui-sans-serif, system-ui, sans-serif`), not the
product's: the diagram is an image, an image cannot use a font the page loaded,
and measuring in one face while drawing in another clips labels.

Drawn, the block is the image, in a box that scrolls sideways when it is wider
than the column, above a disclosure named `Source` that holds the code block
unchanged. Not drawn, it is that code block and one line in `text-caption`,
`text-muted`, saying why.
```

Then add a dated line to that document's amendment record, in the form its newest entries use (read the end of §"October 2026 remediation" for the form).

- [ ] **Step 3: `README.md`, the canonical table**

Add after the "Content-Security-Policy" row:

```markdown
| Mermaid in the reader | [Spec](docs/superpowers/specs/2026-10-13-reader-mermaid-design.md) | [Plan](docs/superpowers/plans/2026-10-13-reader-mermaid.md) | A `mermaid` block drawn as an image in the reader and on shared pages, never as markup; left as code, with a reason, when it cannot be. |
```

- [ ] **Step 4: The two older specs, and this one's status**

In `2026-09-29-personal-daily-driver-design.md`, directly under the line that begins `**Deferred to later batches:**`, add:

```markdown
> Mermaid is no longer deferred: `2026-10-13-reader-mermaid-design.md` (2026-10-13). The line above is left as it was written.
```

In `2026-10-12-content-security-policy-design.md`, at the end, add:

```markdown
## Later: `blob:` in `img-src` (2026-10-13)

`img-src 'self'` became `img-src 'self' blob:` so that a page can show a diagram
it drew itself. Why that admits nothing a document can name is in
`2026-10-13-reader-mermaid-design.md`, "Content-Security-Policy".
```

In `2026-10-13-reader-mermaid-design.md`, replace the `**Status:**` paragraph with `**Status:** agreed with the user on 2026-10-13, including the three decisions first made in drafting; built by `../plans/2026-10-13-reader-mermaid.md`.` and remove the three `(to confirm)` marks. If Task 1 changed a row of "Assumed of Mermaid 12", that row now says what was found and what was done.

- [ ] **Step 5: The whole gate**

```bash
make verify; echo "EXIT=$?"
```

Expected: unit, typecheck, lint and build all pass, `EXIT=0`. Read the output for the unit test count; a count of zero is a run that did not happen.

- [ ] **Step 6: Measure what the spec said would be measured**

From the build output of Step 5 and one manual look (`make dev`, a document holding a flowchart, browser network panel filtered to JS):

- the transferred size of the chunks fetched only once a diagram is on the page;
- that a document with no `mermaid` block fetches none of them;
- a page opened at `#heading` where the heading is below a diagram: where it lands once the diagram is drawn.

Append to `docs/superpowers/verification/2026-10-13-reader-mermaid.md`:

```markdown
## Runs

- `make verify`, <date>: <unit test count> unit tests, typecheck, lint, build. Exit 0.
- `make test-e2e`, <date>: <count> tests. Exit 0. `zz-mermaid.spec.ts` 7, `zz-mermaid-hostile.spec.ts` 1.

## Measured

- Chunks fetched for a page with one flowchart: <n> files, <kB> transferred.
- A page with no `mermaid` block: none of them fetched.
- Opened at a heading below a diagram: <lands on the heading | lands N px off>.

## Not measured

- How many stored documents hold a `mermaid` block.
- Browsers other than Chromium. The image approach rests on behaviour all three engines share, and it was run in one.
```

Fill each `<…>` from what was seen. If the heading lands off by enough to hide it, say so here and tell the user; the spec left that alone "unless it is seen".

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md README.md docs/superpowers
git commit -m "docs(reader): mermaid in the reader — invariant, design language, canonical table, evidence"
```

---

## Self-review notes

Spec coverage, section by section:

| Spec section | Task |
| --- | --- |
| The decision: an image, not markup | 3 (`toUrl` only), 4 (`<img>`), 6 hostile |
| What B does not cover | 4 (`strict`, `htmlLabels: false`), 6 hostile (strays, script) |
| What is drawn | 4 (`isMermaid`, unit cases) |
| How, 1–5 | 3, 4 |
| When a block is not drawn | 3 (each reason), 4 (the line), 6 (broken block) |
| `<foreignObject>` | 1 (which types), 3 |
| How it looks: figure, source, alt, colour, theme, font, print, layout shift | 4, 6 (theme, wide), 7 (design language; heading offset measured) |
| Comments | 5, 6 |
| Where | 4 (reader, shared), 6 (shared, editor round trip); composer by the bundle test |
| Content-Security-Policy | 2, 6 (header on the shared page) |
| Dependency | 1, 4 (bundle tests), 7 (sizes) |
| Assumed of Mermaid 12 | 1 |
| Documents changed with the code | 7 |

Not in the plan, as the spec says: the rendered editor, comments on the picture, export, zoom, server drawing, other diagram languages, the user guide.
