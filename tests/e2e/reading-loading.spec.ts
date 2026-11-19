import { expect, test as base } from "./fixtures/test";
import { personalWorkspaceId } from "./fixtures/my-space";

// The suite shares My Space across files. Keep these temporary documents out
// of later graph layouts and explorer menus, even when an assertion fails.
const test = base.extend<{ loadingDocuments: string[] }>({
  loadingDocuments: async ({ request }, use) => {
    const documentIds: string[] = [];
    try {
      await use(documentIds);
    } finally {
      for (const documentId of documentIds) {
        const response = await request.post(`/api/documents/${documentId}/archive`);
        expect(response.status(), `archive loading fixture ${documentId}`).toBe(200);
      }
    }
  },
});

const ROUND_TRIP = { timeout: 15_000 };
const paragraphs = Array.from({ length: 45 }, (_, index) => `Paragraph ${index}: document content that keeps the reading pane scrollable.`).join("\n\n");

for (const scenario of [
  { name: "wide pane", width: 1440, inspector: false },
  { name: "wide pane with details", width: 1800, inspector: true },
  { name: "narrow pane with details", width: 1440, inspector: true },
  { name: "small desktop pane", width: 1100, inspector: false },
  { name: "mobile", width: 390, inspector: false },
]) {
  test(`document loading keeps the reading column aligned: ${scenario.name}`, async ({ page, loadingDocuments }) => {
    await page.setViewportSize({ width: scenario.width, height: 900 });
    const workspaceId = await personalWorkspaceId(page);
    const stamp = `${scenario.width}-${Date.now()}`;
    const withOutlineTitle = `Loading outline ${stamp}`;
    const plainTitle = `Loading plain ${stamp}`;
    const create = async (title: string, markdown: string) => {
      const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown } });
      expect(response.status()).toBe(201);
      const { sourceId, documentId } = await response.json() as { sourceId: string; documentId: string };
      loadingDocuments.push(documentId);
      return `/w/${workspaceId}/knowledge/${sourceId}/${documentId}`;
    };
    const destination = await create(withOutlineTitle, `## First section\n\n[[${plainTitle}]]\n\n${paragraphs}\n\n## Last section\n\nEnd.`);
    const start = await create(plainTitle, `[[${withOutlineTitle}]]\n\n${paragraphs}`);
    let destinationPrefetched = false;
    page.on("response", (response) => {
      if (new URL(response.url()).pathname === destination && response.request().headers()["next-router-prefetch"]) destinationPrefetched = true;
    });
    await page.goto(start);
    const content = page.getByRole("region", { name: "Document content", exact: true });
    const readingColumn = content.locator(".kh-reading-column").filter({
      has: page.locator("article:visible").or(page.getByText("Loading document", { exact: true })),
    });
    await expect(content.locator("article:visible")).toBeVisible(ROUND_TRIP);
    if (scenario.inspector) {
      await page.getByRole("button", { name: "Details", exact: true }).first().click();
      await expect(page.getByRole("complementary", { name: "Document details", exact: true })).toBeVisible();
    }
    const before = await readingColumn.boundingBox();
    expect(before).not.toBeNull();

    // The prefetched loading boundary can render while the document response
    // waits. Hold only navigation data, leaving that boundary available.
    await page.route(`**${destination}?*`, async (route) => {
      if (route.request().headers()["next-router-prefetch"]) return route.continue();
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({ response });
    });
    const mobile = scenario.width < 1024;
    if (mobile) {
      await page.getByRole("button", { name: "Open menu", exact: true }).click();
    }
    // The tree reveals the current document as it hydrates. Let that settle
    // before bringing the destination link into view so Next can prefetch it.
    const tree = page.getByRole("tree", { name: "Knowledge tree" }).filter({
      has: page.getByRole("link", { name: withOutlineTitle, exact: true }),
    });
    await expect(tree).toHaveAttribute("aria-busy", "false", ROUND_TRIP);
    const destinationLink = tree.getByRole("link", { name: withOutlineTitle, exact: true });
    if (mobile) await destinationLink.scrollIntoViewIfNeeded();
    else await destinationLink.hover();
    await expect.poll(() => destinationPrefetched, ROUND_TRIP).toBe(true);
    if (mobile) {
      await destinationLink.click();
      await expect(page.locator("[role=dialog]")).toHaveCount(0, ROUND_TRIP);
    } else {
      // The article link can reuse the tree link's prefetched boundary.
      await content.getByRole("link", { name: withOutlineTitle, exact: true }).click();
    }
    await expect(content.getByRole("status")).toHaveText("Loading document");
    const loading = await readingColumn.boundingBox();
    expect(loading).not.toBeNull();
    expect(Math.abs(loading!.x - before!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(loading!.width - before!.width)).toBeLessThanOrEqual(1);
    await test.info().attach("loading", { body: await page.screenshot(), contentType: "image/png" });

    await expect(content.locator("article:visible")).toBeVisible(ROUND_TRIP);
    await expect(page).toHaveURL(new RegExp(`${destination}$`));
    const after = await readingColumn.boundingBox();
    expect(after).not.toBeNull();
    expect(Math.abs(after!.x - loading!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after!.width - loading!.width)).toBeLessThanOrEqual(1);
    expect(await content.evaluate((pane) => pane.scrollWidth <= pane.clientWidth)).toBe(true);
    await expect(content).not.toHaveAttribute("aria-busy", "true");
    await test.info().attach("loaded", { body: await page.screenshot(), contentType: "image/png" });

    // Returning to a document without an outline must also keep its position. A tap inside the
    // editable article places the caret on mobile instead of following the link, so return by
    // address there; this test is about the loading column, not the editor's tap behaviour.
    if (scenario.width < 640) {
      await page.goto(new URL(start, page.url()).toString(), { waitUntil: "domcontentloaded" });
    } else {
      await content.getByRole("link", { name: plainTitle, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${start}$`), ROUND_TRIP);
    }
    await expect(content.locator("article:visible")).toBeVisible(ROUND_TRIP);
    const returned = await readingColumn.boundingBox();
    expect(Math.abs(returned!.x - before!.x)).toBeLessThanOrEqual(1);
    await expect(page.getByRole("complementary", { name: "On this page", exact: true })).toHaveCount(0);
    if (scenario.inspector) {
      await expect(page.getByRole("complementary", { name: "Document details", exact: true })).toBeVisible();
    }
  });
}
