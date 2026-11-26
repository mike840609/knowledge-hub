import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

/**
 * Reader chrome (docs/superpowers/specs/2026-11-25-reader-chrome-polish-design.md): the title before its meta line,
 * Read only as a badge with a popover, the breadcrumb that keeps the page's name, a labelled Share, and a table that
 * scrolls sideways only where its column is narrow. It writes into the E2E user's My Space, so it sorts last.
 */

const ROUND_TRIP = { timeout: 15_000 };
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

const TABLE = [
  "| metric | headcount_daily | owner_email_address |",
  "| --- | --- | --- |",
  "| attendance | headcount_daily_rollup | someone.with.a.long.name@example.com |",
].join("\n");
const MARKDOWN = (title: string) => `# ${title}\n\nA paragraph that opens the page.\n\n## Numbers\n\n${TABLE}\n\nAfter the table.\n`;

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** A synced folder source with `handbook/leave.md`, which is read only; returns where to open it. */
async function syncedPage(page: Page) {
  const workspaceId = await mySpace(page);
  const request = page.request;
  const title = "Leave policy";
  const files = [{ path: "handbook/leave.md", bytes: Buffer.from(MARKDOWN(title), "utf8") }];
  const staged = await request.post(`/api/workspaces/${workspaceId}/source-imports`, {
    data: { sourceName: unique("Sample wiki"), rootName: "Knowledge folder", manifest: files.map((f, i) => ({ uploadKey: `m${i}`, relativePath: f.path, kind: "MARKDOWN", size: f.bytes.length })) },
  });
  expect(staged.ok()).toBe(true);
  const { snapshotId } = (await staged.json()) as { snapshotId: string };
  const multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = { entries: JSON.stringify(files.map((_, i) => ({ uploadKey: `m${i}`, field: `f${i}` }))) };
  files.forEach((f, i) => { multipart[`f${i}`] = { name: "leave.md", mimeType: "text/markdown", buffer: f.bytes }; });
  expect((await request.post(`/api/source-imports/${snapshotId}/entries`, { multipart })).ok()).toBe(true);
  expect((await request.post(`/api/source-imports/${snapshotId}/finalize`, { data: {} })).ok()).toBe(true);
  const applied = await request.post(`/api/source-imports/${snapshotId}/apply`, { data: {} });
  expect(applied.ok()).toBe(true);
  const { sourceId } = (await applied.json()) as { sourceId: string };
  const tree = await (await request.get(`/api/workspaces/${workspaceId}/sources/${sourceId}/tree`)).json() as { tree: { type: string; documentId?: string }[] };
  const documentId = tree.tree.find((item) => item.type === "document")!.documentId!;
  return { workspaceId, sourceId, documentId, title, url: `/w/${workspaceId}/knowledge/${sourceId}/${documentId}` };
}

async function writersNote(page: Page) {
  const workspaceId = await mySpace(page);
  const title = unique("Writer note");
  const created = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown: MARKDOWN(title) } });
  expect(created.ok()).toBe(true);
  const { sourceId, documentId } = (await created.json()) as { sourceId: string; documentId: string };
  return { title, url: `/w/${workspaceId}/knowledge/${sourceId}/${documentId}` };
}

const noPageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe("a read-only synced page", () => {
  test("phone: the title comes first, the badge explains itself from the keyboard, the table keeps its words whole", async ({ page }) => {
    await page.setViewportSize(PHONE);
    const doc = await syncedPage(page);
    await page.goto(doc.url);
    const title = page.locator("main article h1").first();
    await expect(title).toHaveText(doc.title, ROUND_TRIP);
    const meta = page.locator("[data-document-meta]");
    await expect(meta).toContainText("Updated");
    const [titleBox, metaBox] = await Promise.all([title.boundingBox(), meta.boundingBox()]);
    expect(titleBox!.y).toBeLessThan(metaBox!.y);
    expect(titleBox!.y).toBeLessThan(160);
    // The meta line is one badge and a short line, not three lines of prose above the title.
    expect(metaBox!.height).toBeLessThan(60);
    expect(await noPageScroll(page)).toBe(true);

    const badge = meta.getByRole("button", { name: "Read only" });
    await badge.focus();
    await page.keyboard.press("Enter");
    const popup = page.getByRole("dialog").filter({ hasText: "Edit the file in your folder" });
    await expect(popup).toBeVisible();
    await expect(popup.getByRole("link", { name: "update from folder" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popup).toBeHidden();

    const region = page.getByRole("region", { name: "Table" });
    await region.scrollIntoViewIfNeeded();
    const facts = await region.evaluate((element) => {
      const style = getComputedStyle(element);
      const cell = [...element.querySelectorAll("th")].find((item) => item.textContent === "headcount_daily")!;
      const range = document.createRange();
      range.selectNodeContents(cell);
      return { scrolls: element.scrollWidth > element.clientWidth, tabIndex: element.getAttribute("tabindex"), overflowY: style.overflowY, tall: element.scrollHeight > element.clientHeight + 1, lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size };
    });
    expect(facts.scrolls).toBe(true);
    expect(facts.tabIndex).toBe("0");
    expect(facts.overflowY).toBe("hidden");
    expect(facts.tall).toBe(false);
    expect(facts.lines).toBe(1);
    expect(await noPageScroll(page)).toBe(true);
  });

  test("phone: the breadcrumb keeps the page's name whole and folds the middle into a menu", async ({ page }) => {
    await page.setViewportSize(PHONE);
    const doc = await syncedPage(page);
    await page.goto(doc.url);
    const nav = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(nav.locator("[aria-current=page]")).toHaveText(doc.title, ROUND_TRIP);
    const whole = await nav.locator("[aria-current=page]").evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
    expect(whole).toBe(true);
    await expect(nav.getByText("handbook", { exact: true })).toBeHidden();
    const more = nav.getByRole("button", { name: /more level/ });
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "handbook" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("desktop: every level is shown, the table fits whole with no scrollbar, and the title is first", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const doc = await syncedPage(page);
    await page.goto(doc.url);
    const title = page.locator("main article h1").first();
    await expect(title).toHaveText(doc.title, ROUND_TRIP);
    const nav = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(nav.getByText("handbook", { exact: true })).toBeVisible();
    await expect(nav.getByRole("button", { name: /more level/ })).toBeHidden();
    const [titleBox, metaBox] = await Promise.all([title.boundingBox(), page.locator("[data-document-meta]").boundingBox()]);
    expect(titleBox!.y).toBeLessThan(metaBox!.y);
    const region = page.getByRole("region", { name: "Table" });
    const facts = await region.evaluate((element) => ({ scrolls: element.scrollWidth > element.clientWidth, tabIndex: element.getAttribute("tabindex") }));
    expect(facts).toEqual({ scrolls: false, tabIndex: null });
  });
});

test.describe("a writer's own note", () => {
  test("desktop: the title is above its meta line, and Share is labelled", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const note = await writersNote(page);
    await page.goto(note.url);
    await expect(page.getByRole("textbox", { name: "Content", exact: true })).toBeEditable(ROUND_TRIP);
    const title = page.locator("main .kh-editor h1").first();
    const meta = page.locator("[data-document-meta]");
    await expect(meta).toContainText("Updated");
    await expect(page.locator("[data-title-meta]")).toHaveCount(1);
    const [titleBox, metaBox] = await Promise.all([title.boundingBox(), meta.boundingBox()]);
    expect(titleBox!.y).toBeLessThan(metaBox!.y);
    const share = page.getByRole("button", { name: "Share link…" });
    await expect(share).toContainText("Share");
    await expect(share.getByText("Share", { exact: true })).toBeVisible();
    // The saved page does not carry the slot.
    expect(await page.locator("main .kh-editor").first().evaluate((element) => element.textContent?.includes("Updated"))).toBe(true);
  });

  test("phone: Share is the icon alone, and the editor's table scrolls sideways only", async ({ page }) => {
    await page.setViewportSize(PHONE);
    const note = await writersNote(page);
    await page.goto(note.url);
    await expect(page.getByRole("textbox", { name: "Content", exact: true })).toBeEditable(ROUND_TRIP);
    const share = page.getByRole("button", { name: "Share link…" });
    await expect(share).toBeVisible();
    await expect(share.getByText("Share", { exact: true })).toBeHidden();
    const title = page.locator("main .kh-editor h1").first();
    const [titleBox, metaBox] = await Promise.all([title.boundingBox(), page.locator("[data-document-meta]").boundingBox()]);
    expect(titleBox!.y).toBeLessThan(metaBox!.y);
    const region = page.locator("main .kh-editor .kh-markdown-table").first();
    const facts = await region.evaluate((element) => ({ scrolls: element.scrollWidth > element.clientWidth, overflowY: getComputedStyle(element).overflowY }));
    expect(facts).toEqual({ scrolls: true, overflowY: "hidden" });
    expect(await noPageScroll(page)).toBe(true);
  });
});

/**
 * The page's own name gives way last: it is drawn whole (its text's width against the box it was given; a scrollWidth
 * check rounds away the fraction of a pixel an ellipsis needs), or the first level has already given all it can.
 */
async function expectPageNameLast(page: Page, title: string) {
  const nav = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(nav.locator("[aria-current=page]")).toHaveText(title, ROUND_TRIP);
  const facts = await nav.evaluate((element) => {
    const name = element.querySelector("[aria-current=page]")!;
    const first = element.querySelector<HTMLElement>("[data-crumb=first]")!;
    const range = document.createRange();
    range.selectNodeContents(name);
    const facts = { text: range.getBoundingClientRect().width, box: name.getBoundingClientRect().width, first: first.getBoundingClientRect().width, firstMin: 0 };
    // min-width is `min(3ch, 16%)`, which computed style leaves unresolved: lay the item out at nothing to read it.
    first.style.flex = "0 0 0px";
    facts.firstMin = first.getBoundingClientRect().width;
    first.style.flex = "";
    return facts;
  });
  if (facts.text > facts.box) expect(facts.first, `"${title}" is cut while the first level could give more`).toBeLessThanOrEqual(facts.firstMin + 0.5);
  return facts;
}

test.describe("on a touch phone", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: PHONE });

  test("the breadcrumb gives way at its first level before the page's name, three levels deep and two", async ({ page }) => {
    const doc = await syncedPage(page);
    await page.goto(doc.url);
    await expectPageNameLast(page, doc.title);

    const workspaceId = await mySpace(page);
    const created = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title: "Onboarding guide", markdown: "Body.\n" } });
    expect(created.ok()).toBe(true);
    const { sourceId, documentId } = (await created.json()) as { sourceId: string; documentId: string };
    await page.goto(`/w/${workspaceId}/knowledge/${sourceId}/${documentId}`);
    // Two levels: the first is also the parent, and still gives way before the name.
    await expectPageNameLast(page, "Onboarding guide");
    expect(await noPageScroll(page)).toBe(true);
  });
});
