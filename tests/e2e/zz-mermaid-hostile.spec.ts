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
      strays: document.querySelectorAll("article svg:not(button svg), article script, article style, foreignObject, [id^='kh-diagram'], [id^='dkh-diagram'], img[onerror], body > svg").length,
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
