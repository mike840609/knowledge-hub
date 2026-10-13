// Checks, in a real browser and under the production policy, what
// docs/superpowers/specs/2026-10-13-reader-mermaid-design.md assumes of Mermaid.
// Run before changing mermaid's version, and after:  node scripts/test/mermaid-assumptions.mjs
// It exits non-zero when an assumption fails. Nothing here is drawn by the product: it is the
// evidence for the lists in src/components/knowledge/mermaid-queue.ts, which this file holds copies of.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

// Copies of the three lists in mermaid-queue.ts. tests/unit/mermaid-assumptions-lists.test.ts fails when they differ.
const DRAWN_TYPES = ["flowchart-v2", "sequence", "classDiagram", "stateDiagram", "er", "gantt", "pie", "mindmap", "timeline", "quadrantChart", "gitGraph", "requirement", "c4", "sankey", "xychart", "block", "kanban", "packet", "radar", "treemap"];
const SECURE = ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges", "htmlLabels", "dompurifyConfig", "themeCSS", "fontFamily", "altFontFamily", "theme", "themeVariables", "layout"];
const SANITIZER = { ALLOWED_TAGS: ["br"], ALLOWED_ATTR: [] };

const DIST = path.join("node_modules", "mermaid", "dist");
const ORIGIN = "http://mermaid.test";
// What a production page allows a script it loaded: no 'unsafe-eval', no 'unsafe-inline', and the fetch
// directives of src/lib/content-security-policy.ts.
const POLICY = "script-src 'self'; img-src 'self' blob:; media-src 'none'; object-src 'none'; base-uri 'self'";

// Hostile text: elements that fetch when they are in a page, a handler, and a word to find the text by.
const ELSEWHERE = "//attacker.example";
const H = `khmark<video src=${ELSEWHERE}/v.mp4 preload=auto></video><img src=${ELSEWHERE}/i.png onerror=window.khPwned=1><a href=${ELSEWHERE}/a>x</a>`;
// `$$…$$` makes Mermaid 12.2.0 write a label as HTML whatever `htmlLabels` says (`hasKatex`, read in its source).
const M = "$$x^2$$" + H;
const bare = (text, drop) => text.replace(drop, "");

/** A plain sample of each drawn type: it must be drawn, with no `<foreignObject>`, and load as an image. */
const PLAIN = {
  "flowchart-v2": "flowchart LR\n  A[Start] --> B{Choice}\n  B -->|yes| C[Done]",
  sequence: "sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi",
  classDiagram: "classDiagram\n  class Animal {\n    +String name\n    +eat()\n  }\n  Animal <|-- Dog",
  stateDiagram: "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy\n  Busy --> [*]",
  er: "erDiagram\n  CUSTOMER ||--o{ ORDER : places",
  gantt: "gantt\n  dateFormat YYYY-MM-DD\n  section A\n  Task :a1, 2026-01-01, 3d",
  pie: 'pie\n  "A" : 3\n  "B" : 1',
  mindmap: "mindmap\n  root((Root))\n    Left\n    Right",
  timeline: "timeline\n  title History\n  2020 : One\n  2021 : Two",
  quadrantChart: "quadrantChart\n  title Reach\n  x-axis Low --> High\n  y-axis Low --> High\n  A: [0.3, 0.6]",
  gitGraph: "gitGraph\n  commit\n  branch dev\n  commit\n  checkout main\n  merge dev",
  requirement: "requirementDiagram\n  requirement r1 {\n    id: 1\n    text: one\n    risk: high\n    verifymethod: test\n  }",
  c4: 'C4Context\n  Person(a, "User")\n  System(b, "System")\n  Rel(a, b, "Uses")',
  sankey: "sankey-beta\n\nA,B,10\nB,C,5",
  xychart: 'xychart-beta\n  title "Sales"\n  x-axis [a, b]\n  y-axis "Y" 0 --> 10\n  bar [1, 2]',
  block: 'block-beta\n  columns 2\n  a["A"] b["B"]\n  a --> b',
  kanban: "kanban\n  todo[Todo]\n    t1[Task]",
  packet: 'packet-beta\n  0-15: "Source"\n  16-31: "Destination"',
  radar: 'radar-beta\n  axis a["A"], b["B"], c["C"]\n  curve x["X"]{1,2,3}',
  treemap: 'treemap-beta\n"Root"\n    "A": 10\n    "B": 5',
};

/**
 * Hostile text in each place a type takes text, by type. `(h) => source`; each is laid out twice, with H and with M.
 * A sample that does not parse is no evidence, so one that throws fails the run.
 */
const HOSTILE = {
  "flowchart-v2": {
    label: (h) => `flowchart LR\n  A["${h}"] --> B`,
    shapes: (h) => `flowchart LR\n  A("${h}") --> B(["${h}"])\n  B --> C[["${h}"]]\n  C --> D[("${h}")]\n  D --> E(("${h}"))\n  E --> F{"${h}"}\n  F --> G{{"${h}"}}\n  G --> I[/"${h}"/]\n  I --> J>"${h}"]`,
    edge: (h) => `flowchart LR\n  A -->|"${h}"| B\n  B -- "${h}" --> C`,
    subgraph: (h) => `flowchart LR\n  subgraph S["${h}"]\n  A --> B\n  end`,
    markdown: (h) => "flowchart LR\n  A[\"`**b** " + h + "`\"] --> B\n  A -->|\"`" + h + "`\"| C",
    shapeData: (h) => `flowchart LR\n  A@{ shape: rounded, label: "${h}" } --> B@{ shape: text, label: "${h}" }\n  B --> C@{ shape: doc, label: "${h}" }\n  C --> D@{ icon: "fa:user", label: "${h}", form: "square" }`,
    accessibility: (h) => `flowchart LR\n  accTitle: ${h}\n  accDescr: ${h}\n  A --> B`,
    title: (h) => `---\ntitle: '${h}'\n---\nflowchart LR\n  A --> B`,
    tooltip: (h) => `flowchart LR\n  A --> B\n  click A href "https://example.com/x" "${h}"`,
    graph: (h) => `graph TD\n  A["${h}"] --> B`,
    handDrawn: (h) => `%%{init: {"look": "handDrawn"}}%%\nflowchart LR\n  A["${h}"] -->|"${h}"| B`,
    icon: (h) => `flowchart LR\n  A["fa:fa-car ${h}"] --> B`,
  },
  sequence: {
    messages: (h) => `sequenceDiagram\n  title ${h}\n  participant A as ${h}\n  actor B as ${h}\n  A->>B: ${h}\n  Note over A: ${h}\n  loop ${h}\n  B-->>A: ${h}\n  end\n  alt ${h}\n  A->>B: x\n  else ${h}\n  A->>B: y\n  end\n  rect rgb(200,200,200)\n  A->>B: z\n  end`,
    blocks: (h) => `sequenceDiagram\n  box Aqua ${h}\n  participant A\n  end\n  participant B\n  A->>+B: ${h}\n  B-->>-A: ${h}\n  Note right of B: ${h}\n  par ${h}\n  A->>B: p\n  and ${h}\n  A->>B: q\n  end\n  critical ${h}\n  A->>B: c\n  option ${h}\n  A->>B: d\n  end\n  opt ${h}\n  A->>B: o\n  end\n  break ${h}\n  A->>B: b\n  end`,
    links: (h) => `sequenceDiagram\n  participant A\n  link A: ${h} @ https://example.com/dash\n  links A: {"khmark": "https://example.com/x"}\n  properties A: {"class": "khmark"}\n  A->>A: ${h}`,
    participants: (h) => `sequenceDiagram\n  participant A@{ "type": "boundary", "alias": "${h}" }\n  participant B@{ "type": "database" }\n  create participant C as ${h}\n  A->>C: ${h}\n  destroy C\n  C->>A: bye\n  autonumber\n  A->>B: ${h}`,
    foreignText: (h) => `%%{init: {"sequence": {"textPlacement": "fo"}}}%%\nsequenceDiagram\n  participant A as ${h}\n  A->>A: ${h}`,
  },
  classDiagram: {
    labels: (h) => `classDiagram\n  class A["${h}"] {\n    +String name\n    +eat() void\n  }\n  note for A "${h}"\n  note "${h}"\n  A <|-- B : ${bare(h, /[<>]/g)}\n  A "1" --> "many" B : khmark`,
    members: (h) => `classDiagram\n  class A {\n    <<interface>>\n    +khmark ${h}\n    +List~T~ items\n  }\n  namespace NS {\n    class C["${h}"]\n  }\n  click A href "https://example.com/x" "${h}"\n  link C "https://example.com/y" "${h}"`,
    title: (h) => `---\ntitle: '${h}'\n---\nclassDiagram\n  direction LR\n  accTitle: ${h}\n  accDescr: ${h}\n  class A`,
    styled: (h) => `classDiagram\n  class A["${h}"]\n  style A fill:#f00,color:red`,
  },
  stateDiagram: {
    states: (h) => `stateDiagram-v2\n  state "${h}" as s1\n  [*] --> s1\n  s1 --> s2: ${h}\n  note right of s1\n    ${h}\n  end note\n  s2: ${h}\n  state s3 {\n    [*] --> s4\n  }\n  s2 --> s3`,
    older: (h) => `stateDiagram\n  accTitle: ${h}\n  accDescr: ${h}\n  [*] --> s1\n  s1: ${h}\n  state fork <<fork>>\n  state c <<choice>>\n  s1 --> fork\n  fork --> c\n  note left of s1: ${h}\n  click s1 href "https://example.com/x"`,
  },
  er: {
    all: (h) => `erDiagram\n  accTitle: ${h}\n  A ||--o{ B : "${h}"\n  A {\n    string name PK "${h}"\n    int khmark\n  }\n  C["${h}"] {\n    string id\n  }`,
  },
  gantt: {
    all: (h) => `gantt\n  title ${h}\n  dateFormat YYYY-MM-DD\n  section ${h}\n  ${h} :a1, 2026-01-01, 3d\n  click a1 href "https://example.com/x"\n  accTitle: ${h}`,
  },
  pie: { all: (h) => `pie showData title ${h}\n  "${h}" : 3\n  "B" : 1` },
  mindmap: {
    shapes: (h) => `mindmap\n  root(("${h}"))\n    ["${h}"]\n    ("${h}")\n    ${bare(h, /[()[\]]/g)}\n      ::icon(fa fa-book)\n    ))"${h}"((\n    {{"${h}"}}\n    )"${h}"(`,
    markdown: (h) => "mindmap\n  root\n    A[\"`**b** " + h + "`\"]",
  },
  timeline: { all: (h) => `timeline\n  title ${h}\n  section ${h}\n  2020 : ${h}\n       : ${h}\n  ${h} : x` },
  quadrantChart: { all: (h) => `quadrantChart\n  title ${h}\n  x-axis "${h}" --> "${h}"\n  y-axis "${h}" --> "${h}"\n  quadrant-1 "${h}"\n  quadrant-2 B\n  "${h}": [0.3, 0.6]` },
  gitGraph: { all: (h) => `gitGraph\n  commit id: "${h}" tag: "${h}"\n  branch "khmark"\n  commit id: "x" msg: "${h}"\n  checkout main\n  merge "khmark" id: "m" tag: "${h}"` },
  requirement: { all: (h) => `requirementDiagram\n  requirement "${h}" {\n    id: 1\n    text: "${h}"\n    risk: high\n    verifymethod: test\n  }\n  element "khmark" {\n    type: "${h}"\n    docref: "${h}"\n  }\n  "khmark" - satisfies -> "${h}"` },
  c4: { all: (h) => `C4Context\n  title ${h}\n  Person(a, "${h}", "${h}")\n  System(b, "${h}", "${h}")\n  Boundary(c, "${h}") {\n    System(d, "${h}")\n  }\n  Rel(a, b, "${h}", "${h}")` },
  sankey: { all: (h) => `sankey-beta\n\n"${h}",B,10\nB,"${h} 2",5` },
  xychart: { all: (h) => `xychart-beta\n  title "${h}"\n  x-axis "${h}" ["${h}", b]\n  y-axis "${h}" 0 --> 10\n  bar [1, 2]\n  line [2, 3]` },
  block: { all: (h) => `block-beta\n  columns 2\n  a["${h}"] b("${h}")\n  block:g\n    c["${h}"]\n  end\n  a -- "${h}" --> b` },
  kanban: { all: (h) => `kanban\n  todo[${bare(h, /[[\]]/g)}]\n    t1[${bare(h, /[[\]]/g)}]@{ assigned: "${h}", ticket: "khmark", priority: "High" }` },
  packet: { all: (h) => `packet-beta\n  title ${h}\n  0-15: "${h}"\n  16-31: "B"` },
  radar: { all: (h) => `radar-beta\n  title ${h}\n  axis a["${h}"], b["B"], c["C"]\n  curve x["${h}"]{1,2,3}` },
  treemap: { all: (h) => `treemap-beta\n"${h}"\n    "${h} 2": 10\n    "x": 5` },
};

/**
 * Text the reader must leave as code or refuse to draw: `type` is what `parse` must call it, `null` when `parse`
 * must throw and name none. The ones marked `why` are also laid out here, only to record what they would do.
 */
const REFUSED = {
  architecture: { type: "architecture", why: true, source: `architecture-beta\n    service s1"<p>${H}</p>"[T]` },
  eventmodeling: { type: "eventmodeling", why: true, source: `eventmodeling\n\ntf 01 evt CartCreated { ${H} }` },
  journey: { type: "journey", why: true, source: `journey\n  title ${H}\n  section A\n    Task: 5: Me` },
  elkKeyword: { type: "flowchart-elk", source: "flowchart-elk LR\n  A-->B" },
  info: { type: "info", source: "info" },
  errorWord: { type: "error", source: "error" },
  // The type is what follows frontmatter, comments and directives, as `render` reads them, not what they mention.
  disguised: { type: "architecture", source: '---\ntitle: flowchart LR\n---\n%% flowchart LR\n%%{init: {"theme": "dark"}}%%\narchitecture-beta\n    service s1(server)[T]' },
  notADiagram: { type: null, source: "this is not a diagram" },
  badFrontmatter: { type: null, source: "---\nflowchart LR\n  A-->B" },
  unparsed: { type: null, source: "flowchart LR\n  A[Unclosed --> B" },
};

/** Drawn types reached through frontmatter, a comment and a directive: `parse` and `render` must name the same type. */
const ROUNDABOUT = {
  sequence: '%% a comment\n%%{init: {"theme": "dark"}}%%\n\n   sequenceDiagram\n  A->>B: khmark',
  "flowchart-v2": '---\ntitle: architecture-beta\nconfig:\n  flowchart:\n    defaultRenderer: elk\n---\n%% architecture-beta\nflowchart LR\n  A-->B',
};

const browser = await chromium.launch();
const context = await browser.newContext();
/** Every request that left for another origin, of any kind. There must be none. */
const abroad = [];
/** Every file of Mermaid's the page asked for, in order. */
const served = [];
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== ORIGIN) { abroad.push(`${route.request().resourceType()} ${url.href}`); return route.abort(); }
  const name = url.pathname.slice(1);
  if (name === "") return route.fulfill({ contentType: "text/html", headers: { "Content-Security-Policy": POLICY }, body: "<!doctype html><title>t</title><body></body>" });
  try {
    served.push(name);
    await route.fulfill({ contentType: "text/javascript", body: await readFile(path.join(DIST, name)) });
  } catch {
    await route.fulfill({ status: 404, body: "" });
  }
});
const page = await context.newPage();
/** Console lines that say the script policy refused something: an `eval`, or an inline script. */
const scriptRefusals = [];
page.on("console", (message) => { if (/unsafe-eval|EvalError|Refused to (execute|evaluate|load the script)/i.test(message.text())) scriptRefusals.push(message.text()); });
await page.goto(`${ORIGIN}/`);

// Installed before Mermaid is loaded: what the policy refuses, and every node added to the document.
await page.evaluate(async ({ secure, sanitizer }) => {
  const XHTML = "http://www.w3.org/1999/xhtml";
  const seen = { nodes: 0, foreign: [], made: new Set(), violations: [] };
  document.addEventListener("securitypolicyviolation", (event) => { seen.violations.push(`${event.effectiveDirective} ${event.blockedURI}`); });
  // The HTML elements Mermaid's own code makes while it lays a diagram out, by name: its container and the
  // `<style>` it compiles, the box it measures maths in and the wrappers of an HTML label, and the hidden
  // container and canvases of the layout engine a mindmap uses. None takes its tag or an attribute's name from
  // the author's text. Any other HTML element, or one of these with another attribute, is `foreign`.
  const mermaids = (element) =>
    ["div", "span", "br", "style", "canvas"].includes(element.localName) &&
    Array.from(element.attributes).every((attribute) => ["id", "class", "style", "xmlns", "width", "height", "data-id"].includes(attribute.name));
  const note = (records) => {
    for (const record of records) for (const node of record.addedNodes) {
      seen.nodes++;
      if (node.nodeType !== 1) continue;
      for (const element of [node, ...node.querySelectorAll("*")]) {
        if (element.namespaceURI !== XHTML) continue;
        if (mermaids(element)) seen.made.add(element.localName + (element.id && !/\d/.test(element.id) ? `#${element.id}` : ""));
        else seen.foreign.push(`${element.localName}${Array.from(element.attributes).map((attribute) => `[${attribute.name}]`).join("")}`);
      }
    }
  };
  const observer = new MutationObserver(note);
  observer.observe(document, { childList: true, subtree: true });
  const { default: mermaid } = await import("/mermaid.esm.min.mjs");
  const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
  const taken = async () => {
    await settle();
    note(observer.takeRecords());
    const out = { nodes: seen.nodes, foreign: [...new Set(seen.foreign)], made: [...seen.made].sort(), violations: [...new Set(seen.violations)] };
    seen.nodes = 0; seen.foreign = []; seen.made = new Set(); seen.violations = [];
    return out;
  };
  const configure = () => mermaid.initialize({ startOnLoad: false, securityLevel: "strict", htmlLabels: false, suppressErrorRendering: true, secure, dompurifyConfig: sanitizer, theme: "base", fontFamily: "ui-sans-serif, system-ui, sans-serif" });
  const said = (error) => `${error?.name ?? "Error"}: ${String(error?.message ?? error).split("\n")[0].slice(0, 120)}`;
  let serial = 0;
  window.kh = {
    /** What the queue's `inspect` does: the type, by parsing, and what parsing put in the document (nothing). */
    async inspect(source) {
      configure();
      await taken();
      const out = {};
      try { out.type = (await mermaid.parse(source)).diagramType; } catch (error) { out.threw = said(error); }
      out.added = (await taken()).nodes;
      return out;
    },
    /** One layout, watched. */
    async lay(source, id = `check-${++serial}`) {
      configure();
      await taken();
      const out = { id };
      const before = document.body.children.length;
      try {
        const drawn = await mermaid.render(id, source);
        out.type = drawn.diagramType;
        out.svg = drawn.svg;
        out.viewBox = /<svg[^>]*\sviewBox="[^"]+"/.test(drawn.svg);
        out.foreignObject = /<foreignObject[\s>]/i.test(drawn.svg);
        out.marked = drawn.svg.includes("khmark");
        const image = new Image();
        out.loads = await new Promise((resolve) => { image.onload = () => resolve(true); image.onerror = () => resolve(false); image.src = URL.createObjectURL(new Blob([drawn.svg], { type: "image/svg+xml" })); });
      } catch (error) {
        out.threw = said(error);
      }
      Object.assign(out, await taken());
      out.left = document.body.children.length - before;
      out.pwned = window.khPwned ?? null;
      return out;
    },
  };
}, { secure: SECURE, sanitizer: SANITIZER });

const inspect = (source) => page.evaluate((text) => window.kh.inspect(text), source);
const lay = async (source, id) => { const { svg, ...rest } = await page.evaluate(([text, as]) => window.kh.lay(text, as), [source, id]); return { ...rest, svg }; };
const failures = [];
const fail = (message) => { failures.push(message); };
const report = { types: {}, notDrawn: {}, roundabout: {}, carried: {} };

// 1. Each drawn type: found by `parse` without touching the document, and laid out with no element of the
//    author's choosing, plain and with hostile text in each place it takes text.
for (const type of DRAWN_TYPES) {
  const samples = [["plain", PLAIN[type]], ...Object.entries(HOSTILE[type] ?? {}).flatMap(([name, make]) => [[name, make(H)], [`${name} with maths`, make(M)]])];
  if (!PLAIN[type] || samples.length < 3) fail(`${type}: no sample to stand on`);
  const summary = { samples: samples.length, made: new Set(), refusedAfterLayout: [], violations: new Set() };
  for (const [name, source] of samples) {
    if (!source) continue;
    const at = `${type} (${name})`;
    const found = await inspect(source);
    if (found.type !== type) fail(`${at}: parse says ${found.type ?? found.threw}, not ${type}`);
    if (found.added !== 0) fail(`${at}: parsing added ${found.added} node(s) to the document`);
    const laid = await lay(source);
    if (laid.threw) { fail(`${at}: was not laid out, so it is no evidence: ${laid.threw}`); continue; }
    if (laid.type !== found.type) fail(`${at}: render drew ${laid.type}, parse said ${found.type}`);
    if (laid.foreign.length > 0) fail(`${at}: an element of the author's choosing was in the page during layout: ${laid.foreign.join(", ")}`);
    if (laid.pwned !== null) fail(`${at}: a handler ran`);
    if (laid.left !== 0) fail(`${at}: ${laid.left} element(s) left in the page`);
    // The same text follows `$$…$$` in the maths variant, where some labels drop it; the plain variant shows the place is live.
    if (name !== "plain" && !name.endsWith(" with maths") && !laid.marked) fail(`${at}: the hostile text is not in the drawing, so it is no evidence`);
    if (!laid.viewBox) fail(`${at}: no viewBox`);
    if (name === "plain" && laid.foreignObject) fail(`${at}: foreignObject with htmlLabels off`);
    if (name === "plain" && !laid.loads) fail(`${at}: does not load as an image`);
    if (laid.foreignObject) summary.refusedAfterLayout.push(name);
    laid.made.forEach((each) => summary.made.add(each));
    laid.violations.forEach((each) => { summary.violations.add(each); fail(`${at}: the policy had to refuse something: ${each}`); });
  }
  report.types[type] = { samples: summary.samples, mermaidsOwnHtml: [...summary.made].sort(), refusedAfterLayout: summary.refusedAfterLayout, violations: [...summary.violations] };
}

// 2. What is not drawn: `parse` names a type that is not on the list, or names none, and adds nothing to the page.
for (const [name, { type, why, source }] of Object.entries(REFUSED)) {
  const found = await inspect(source);
  if ((found.type ?? null) !== type) fail(`${name}: parse says ${found.type ?? found.threw}, expected ${type}`);
  if (found.type && DRAWN_TYPES.includes(found.type)) fail(`${name}: ${found.type} is on the list`);
  if (found.added !== 0) fail(`${name}: parsing added ${found.added} node(s) to the document`);
  report.notDrawn[name] = { parse: found.type ?? found.threw };
  if (!why) continue;
  // Laid out only to say why the type is not drawn. Not an assumption: nothing fails on it.
  const laid = await lay(source);
  report.notDrawn[name].ifLaidOut = { foreignObject: laid.foreignObject ?? null, authorsHtml: laid.foreign, threw: laid.threw };
}
for (const [type, source] of Object.entries(ROUNDABOUT)) {
  const found = await inspect(source);
  const laid = await lay(source);
  if (found.type !== type || laid.type !== type) fail(`roundabout ${type}: parse says ${found.type ?? found.threw}, render drew ${laid.type ?? laid.threw}`);
  if (laid.foreign.length > 0) fail(`roundabout ${type}: ${laid.foreign.join(", ")}`);
  report.roundabout[type] = { parse: found.type, render: laid.type };
}

// 3. Config carried by a diagram's own text must not undo the configuration.
//    A form that makes render throw is safe; one that yields a foreignObject, or changes the drawing, is not.
const loose = '{"securityLevel": "loose", "htmlLabels": true, "flowchart": {"htmlLabels": true}}';
const html = 'flowchart LR\n  A["<b>bold</b>"] --> B';
const HTML_LABELS = {
  directive: `%%{init: ${loose}}%%\n${html}`,
  lateDirective: html.replace("\n", `\n%%{init: ${loose}}%%\n`),
  frontmatter: `---\nconfig:\n  securityLevel: loose\n  htmlLabels: true\n  flowchart:\n    htmlLabels: true\n---\n${html}`,
};
for (const [name, source] of Object.entries(HTML_LABELS)) {
  const laid = await lay(source);
  report.carried[name] = { gaveHtml: Boolean(laid.foreignObject), threw: laid.threw };
  if (laid.foreignObject) fail(`${name}: turned html labels back on`);
}
// The sanitiser is ours: a directive cannot give Mermaid another, so maths with a tag in it still leaves text.
const maths = `sequenceDiagram\n  Alice->>Bob: ${M}`;
for (const [name, source] of Object.entries({
  sanitiserDirective: `%%{init: {"dompurifyConfig": {"ALLOWED_TAGS": ["video", "img", "a"], "ALLOWED_ATTR": ["src", "href"]}}}%%\n${maths}`,
  sanitiserFrontmatter: `---\nconfig:\n  dompurifyConfig:\n    ALLOWED_TAGS: [video, img, a]\n    ALLOWED_ATTR: [src, href]\n---\n${maths}`,
})) {
  const laid = await lay(source);
  report.carried[name] = { authorsHtml: laid.foreign, threw: laid.threw };
  if (laid.threw) fail(`${name}: was not laid out, so it is no evidence: ${laid.threw}`);
  if (laid.foreign.length > 0) fail(`${name}: replaced the sanitiser: ${laid.foreign.join(", ")}`);
}

// The style, font, theme and layout are ours too. Each of these, carried by the text, must leave the drawing
// exactly as it is without it: the same string, nothing refused by the policy, and no further file fetched
// (a layout engine would be one).
const plain = "flowchart LR\n  A[Start] --> B{Choice}";
const css = `.node rect{background-image:url(${ELSEWHERE}/themecss.png)}`;
const OURS = {
  theme: { theme: "dark" },
  themeVariables: { themeVariables: { primaryColor: "#ff0000", lineColor: "#00ff00" } },
  themeCSS: { themeCSS: css },
  fontFamily: { fontFamily: `x; ${css}` },
  altFontFamily: { altFontFamily: `x; ${css}` },
  layout: { layout: "elk" },
  // At a depth: `secure` is applied to every object in the config, not to its top alone.
  nested: { flowchart: { themeCSS: css, fontFamily: `x; ${css}`, layout: "elk", theme: "dark" } },
};
const yaml = (value, depth = 1) => Object.entries(value).map(([key, each]) => `${"  ".repeat(depth)}${key}:${typeof each === "object" ? `\n${yaml(each, depth + 1)}` : ` ${JSON.stringify(each)}`}`).join("\n");
const baseline = await lay(plain, "check-ours");
if (baseline.threw || !baseline.loads) fail(`the plain flowchart was not drawn: ${baseline.threw}`);
for (const [name, config] of Object.entries(OURS)) {
  for (const [form, source] of [["directive", `%%{init: ${JSON.stringify(config)}}%%\n${plain}`], ["frontmatter", `---\nconfig:\n${yaml(config)}\n---\n${plain}`]]) {
    const before = served.length;
    const laid = await lay(source, "check-ours");
    const fetched = served.slice(before);
    report.carried[`${name} by ${form}`] = { changedTheDrawing: laid.svg !== baseline.svg, violations: laid.violations, fetched, threw: laid.threw };
    if (laid.threw) fail(`${name} by ${form}: was not laid out, so it is no evidence: ${laid.threw}`);
    if (laid.svg !== baseline.svg) fail(`${name} by ${form}: changed the drawing`);
    if (laid.violations.length > 0) fail(`${name} by ${form}: the policy had to refuse something: ${laid.violations.join(", ")}`);
    if (fetched.length > 0) fail(`${name} by ${form}: fetched ${fetched.join(", ")}`);
  }
}

// 4. What only the image policy stops. These reach the page while a drawn type is laid out, and nothing before
//    layout can tell them apart with certainty: the flowchart shape that loads an image by its URL, and a `url()`
//    in an author's `style` or `classDef` line, which Mermaid writes into the page as CSS. The assumption is that
//    each is an image fetch, so that `img-src` refuses it elsewhere; a fetch of any other kind fails the run.
const IMAGE_POLICY = {
  "flowchart image shape": `flowchart LR\n  A@{ img: "https:${ELSEWHERE}/shape.png", label: "x", w: 60, h: 60 }`,
  "class style": `classDiagram\n  class A\n  style A background:url(https:${ELSEWHERE}/s.png),fill:url(https:${ELSEWHERE}/p.svg#a)`,
  "state classDef and style": `stateDiagram-v2\n  [*] --> s1\n  classDef evil background:url(https:${ELSEWHERE}/c.png)\n  class s1 evil\n  style s1 background:url(https:${ELSEWHERE}/t.png)`,
  "block style and classDef": `block-beta\n  a["A"] b\n  style a background:url(https:${ELSEWHERE}/s.png)\n  classDef evil background:url(https:${ELSEWHERE}/c.png)\n  class b evil`,
};
report.onlyTheImagePolicy = {};
for (const [name, source] of Object.entries(IMAGE_POLICY)) {
  const laid = await lay(source);
  report.onlyTheImagePolicy[name] = { violations: laid.violations, threw: laid.threw };
  if (laid.foreign.length > 0) fail(`${name}: ${laid.foreign.join(", ")}`);
  if (laid.violations.length === 0) fail(`${name}: nothing was refused, so this sample no longer shows what the policy stops`);
  for (const each of laid.violations) if (!each.startsWith(`img-src https:${ELSEWHERE}/`)) fail(`${name}: a fetch the image policy does not cover: ${each}`);
}

// 5. A block Mermaid cannot parse must reject, and leave nothing in the page.
const bad = await lay("this is not a diagram");
if (!bad.threw) fail("an unparseable block did not reject");
if (bad.left !== 0) fail(`${bad.left} element(s) left in the page by an unparseable block`);

await browser.close();
console.log(JSON.stringify({ ...report, abroad, scriptRefusals }, null, 2));

if (abroad.length > 0) fail(`request(s) left the origin: ${[...new Set(abroad)].join(", ")}`);
if (scriptRefusals.length > 0) fail("the script policy refused something (eval?)");
if (failures.length > 0) { console.error("FAILED\n" + failures.join("\n")); process.exit(1); }
console.log("OK");
