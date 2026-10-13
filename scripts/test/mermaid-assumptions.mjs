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
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", htmlLabels: false, suppressErrorRendering: true, secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges", "htmlLabels"], theme: "base", fontFamily: "ui-sans-serif, system-ui, sans-serif" });
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
  // Config carried by a diagram's own text must not undo the configuration.
  // A form that makes render throw is safe; one that yields a foreignObject is not.
  const loose = '{"securityLevel": "loose", "htmlLabels": true, "flowchart": {"htmlLabels": true}}';
  const forms = {
    directive: `%%{init: ${loose}}%%\nflowchart LR\n  A["<b>bold</b>"] --> B`,
    lateDirective: `flowchart LR\n%%{init: ${loose}}%%\n  A["<b>bold</b>"] --> B`,
    frontmatter: '---\nconfig:\n  securityLevel: loose\n  htmlLabels: true\n  flowchart:\n    htmlLabels: true\n---\nflowchart LR\n  A["<b>bold</b>"] --> B',
  };
  const carried = {};
  for (const [name, text] of Object.entries(forms)) {
    try {
      const out = await mermaid.render(`check-${name}`, text);
      carried[name] = { gaveHtml: /<foreignObject[\s>]/i.test(out.svg) };
    } catch (error) {
      carried[name] = { gaveHtml: false, threw: String(error).slice(0, 200) };
    }
  }
  // A block Mermaid cannot parse must reject, and leave nothing in the page.
  let rejected = false;
  try { await mermaid.render("check-bad", "this is not a diagram"); } catch { rejected = true; }
  return { types, directiveGaveHtml: carried.directive.gaveHtml, lateDirectiveGaveHtml: carried.lateDirective.gaveHtml, frontmatterGaveHtml: carried.frontmatter.gaveHtml, carried, rejected, leftInPage: body() - before };
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
  ...(result.lateDirectiveGaveHtml ? ["an init directive after the first line turned html labels back on"] : []),
  ...(result.frontmatterGaveHtml ? ["frontmatter config turned html labels back on"] : []),
  ...(result.rejected ? [] : ["an unparseable block did not reject"]),
  ...(result.leftInPage === 0 ? [] : [`${result.leftInPage} element(s) left in the page`]),
  ...(refused.length === 0 ? [] : ["the script policy refused something (eval?)"]),
];
if (failures.length > 0) { console.error("FAILED\n" + failures.join("\n")); process.exit(1); }
console.log("OK");
