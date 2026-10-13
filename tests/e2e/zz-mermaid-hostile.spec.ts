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

// Layout time: what a diagram could make the page do while Mermaid builds it, before any picture exists.
const ELSEWHERE = "https://attacker.example";
/** A type that writes its text into the page as HTML: an element with a `src` of the author's choosing. */
const ARCHITECTURE = `architecture-beta\n    service s1"<p><video src=${ELSEWHERE}/v.mp4 preload=auto></video></p>"[T]`;
const EVENT_MODEL = `eventmodeling\n\ntf 01 evt X { <img src=${ELSEWHERE}/e.png> }`;
/** `$$` makes Mermaid write a label as HTML whatever `htmlLabels` says, in types that are drawn. */
const MATH = `$$x^2$$<video src=${ELSEWHERE}/m.mp4 preload=auto></video><img src=${ELSEWHERE}/m.png>`;
const MATH_SEQUENCE = `sequenceDiagram\n  Alice->>Bob: ${MATH}`;
const MATH_CLASS = `classDiagram\n  class A["${MATH}"]`;
const IMAGE_SHAPE = `flowchart LR\n  A@{ img: "${ELSEWHERE}/shape.png", label: "x", w: 60, h: 60 }`;
/** An author's `style` line is written into the page as CSS while the drawing is laid out; its `url()` is an image fetch. */
const STYLE_URL = `classDiagram\n  class A\n  style A background:url(${ELSEWHERE}/style.png)`;
const THEME_CSS = `%%{init: {"themeCSS": ".node rect{background-image:url(${ELSEWHERE}/themecss.png)}"}}%%\nflowchart LR\n  A-->B`;
const FONT_FAMILY = `%%{init: {"fontFamily": "x; .node rect{background-image:url(${ELSEWHERE}/font.png)}"}}%%\nflowchart LR\n  A-->B`;

const PICTURES = [HANDLER, LOOSE + HANDLER, SCRIPT, LOOSE + SCRIPT, LINK, LOOSE + LINK, CALLBACK, REMOTE, COVER, BREAKOUT];
/** Refused before Mermaid lays anything out: not a type the reader draws. */
const NOT_DRAWN_HERE = [ARCHITECTURE, EVENT_MODEL];
/** Laid out, and refused for the HTML label Mermaid made of it. */
const REFUSED_AFTER = [MATH_SEQUENCE, MATH_CLASS];
/** Its own config is not taken, so it is the plain flowchart beneath. */
const CONFIG_IGNORED = [THEME_CSS, FONT_FAMILY];
const CASES = [...PICTURES, ...NOT_DRAWN_HERE, ...REFUSED_AFTER, IMAGE_SHAPE, STYLE_URL, ...CONFIG_IGNORED];
const MARKDOWN = ["A first paragraph.", "", ...CASES.flatMap((source) => [fence(source), ""]), "A last paragraph."].join("\n");
const UNSUPPORTED = "This kind of diagram cannot be drawn here yet.";

/**
 * Runs before the page's own script. Records what the policy refused, and every HTML element that appears
 * where Mermaid lays a diagram out (the `<div>` it adds to `<body>`, and the one it measures maths in) other
 * than the ones Mermaid's own code makes: a bare `div`, `span`, `br` or `style`. An element the author's text
 * chose (an `<img>`, a `<video>`, anything with a `src`) is recorded.
 */
function watchLayout() {
  const seen = { violations: [] as string[], elements: [] as string[] };
  (window as unknown as { khSeen: typeof seen }).khSeen = seen;
  document.addEventListener("securitypolicyviolation", (event) => { seen.violations.push(`${event.effectiveDirective} ${event.blockedURI}`); });
  const XHTML = "http://www.w3.org/1999/xhtml";
  const top = (node: Node) => { let at = node; while (at.parentNode && at.parentNode !== document.body && at.parentNode.nodeType === 1) at = at.parentNode; return at as Element; };
  const mermaids = (element: Element) =>
    ["div", "span", "br", "style"].includes(element.localName) && Array.from(element.attributes).every((attribute) => ["id", "class", "style", "xmlns"].includes(attribute.name));
  new MutationObserver((records) => {
    for (const record of records) for (const node of Array.from(record.addedNodes)) {
      if (!(node instanceof Element)) continue;
      const root = record.target === document.body ? node : top(record.target);
      if (!/^(dkh-diagram-|katex-temp$)/.test(root.id ?? "")) continue;
      for (const element of [node, ...Array.from(node.querySelectorAll("*"))]) {
        if (element.namespaceURI === XHTML && !mermaids(element)) seen.elements.push(`${element.localName}${Array.from(element.attributes).map((attribute) => `[${attribute.name}]`).join("")}`);
      }
    }
  }).observe(document, { childList: true, subtree: true });
}

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

test("no diagram puts an element, a script, a request or a style of its own onto a shared page, while it is laid out or after", async ({ page, browser }) => {
  await page.goto("/");
  const url = await shareOf(page, MARKDOWN);

  const anonymous = await browser.newContext();
  const origin = new URL(url).origin;
  // What left the browser, of every kind, an image and a video as much as a script: nothing may.
  const abroad: string[] = [];
  await anonymous.route((target) => target.origin !== origin && target.protocol !== "blob:" && target.protocol !== "data:", (route) => {
    abroad.push(`${route.request().resourceType()} ${route.request().url()}`);
    return route.abort();
  });
  await anonymous.addInitScript(watchLayout);
  const visitor = await anonymous.newPage();
  // What the page tried, including what the policy refused before it left: Chromium reports those too.
  const tried = new Set<string>();
  visitor.on("request", (request) => {
    const target = request.url();
    if (!target.startsWith(origin) && !target.startsWith("blob:") && !target.startsWith("data:")) tried.add(`${request.resourceType()} ${target}`);
  });
  const dialogs: string[] = [];
  visitor.on("dialog", (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss(); });

  await visitor.goto(url);
  const figures = visitor.locator("article figure[data-mermaid]");
  await expect(figures).toHaveCount(CASES.length);
  // Each has settled one way or the other; which way is Mermaid's business, and either is safe.
  await expect(visitor.locator("article figure[data-mermaid]:not(:has(img[data-diagram])):not(:has([data-diagram-reason]))")).toHaveCount(0, DRAWN);

  // What is not drawn is the code block it was, open, with why. Two are refused before anything is laid out.
  const at = (source: string) => figures.nth(CASES.indexOf(source));
  for (const source of [...NOT_DRAWN_HERE, ...REFUSED_AFTER]) {
    await expect(at(source).locator("[data-diagram-reason]")).toHaveText(UNSUPPORTED);
    await expect(at(source).locator("details")).toHaveAttribute("open", "");
    await expect(at(source).locator("img")).toHaveCount(0);
  }
  await expect(at(IMAGE_SHAPE).locator("[data-diagram-reason]")).toHaveText(/\S/);
  await expect(at(IMAGE_SHAPE).locator("details")).toHaveAttribute("open", "");
  for (const source of [STYLE_URL, ...CONFIG_IGNORED]) await expect(at(source).locator("img[data-diagram]")).toBeVisible();

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
      seen: (window as unknown as { khSeen: { violations: string[]; elements: string[] } }).khSeen,
      figuresAsBuilt: Array.from(document.querySelectorAll("figure[data-mermaid]")).every(allowed),
      // Nothing of a drawing is in the page: not in the article, and not left behind where Mermaid laid it out.
      strays: document.querySelectorAll("article svg:not(button svg), article script, article style, foreignObject, [id^='kh-diagram'], [id^='dkh-diagram'], #katex-temp, img[onerror], body > svg").length,
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
  // While Mermaid laid them out: no element of the author's choosing was ever in the page.
  expect(page_.seen.elements).toEqual([]);
  // What the policy had to stop, and did (spec, "What B does not cover"): the flowchart shape that loads an image
  // by its URL, and the `url()` in an author's style line. The style and the font a diagram's own config asked
  // for were never taken, so their URLs were never tried.
  const stopped = [`${ELSEWHERE}/shape.png`, `${ELSEWHERE}/style.png`];
  expect(Array.from(new Set(page_.seen.violations)).sort()).toEqual(stopped.map((target) => `img-src ${target}`));
  expect(Array.from(tried).sort()).toEqual(stopped.map((target) => `image ${target}`));
  expect(page_.figuresAsBuilt).toBe(true);
  expect(page_.strays).toBe(0);
  expect(new Set(page_.imageSources)).toEqual(new Set(["blob:"]));
  expect(page_.paragraph).toEqual({ position: "static", display: "block" });
  expect(page_.bodyPosition).toBe("static");
  expect(page_.atCorner).toBe(true);
  await anonymous.close();
});
