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
  // (The copy button's own icon is an <svg>; a diagram's markup is any other.)
  await expect(page.locator("article svg:not(button svg), article foreignObject, article script, article style, body > svg, [id^='kh-diagram'], [id^='dkh-diagram'], img[onerror]")).toHaveCount(0);
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
  test("is drawn there too, with no sign-in and no refusal", async ({ page, browser, baseURL }) => {
    const note = await createNote(page, unique("Shared diagrams"), MARKDOWN);
    const shared = await page.request.post(`/api/documents/${note.documentId}/share-links`, { data: { label: "diagrams", expiresInDays: 1 } });
    expect(shared.status()).toBe(201);
    const { link } = (await shared.json()) as { link: { path: string } };

    const anonymous = await browser.newContext();
    const visitor = await anonymous.newPage();
    const refused = refusals(visitor);
    const response = await visitor.goto(new URL(link.path, baseURL!).toString());
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
