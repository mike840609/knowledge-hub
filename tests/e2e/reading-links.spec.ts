import { expect, test, type Page } from "@playwright/test";
import { phase3UnconfiguredOrigin } from "./fixtures/phase3-identities";
import { openPalette } from "./fixtures/palette";

/**
 * Creates documents in the E2E user's own My Space, and the specs share one
 * database and run in file-name order. phase2.5-routing.spec.ts asserts that a
 * fresh My Space is empty, so this file must sort after it — which is why it is
 * named `reading-…` and not `document-…`. share-link.spec.ts relies on the same
 * ordering for the same reason.
 */

// Same budget and reasoning as phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/** Creates a document in the E2E user's own My Space and returns where it is. */
async function createMySpaceDocument(page: Page, title: string, body: string): Promise<{ workspaceId: string; url: string }> {
  await page.goto("/");
  await page.waitForURL(/\/w\/[^/]+\/knowledge/);
  const workspaceId = new URL(page.url()).pathname.split("/")[2];
  await page.goto(`/w/${workspaceId}/knowledge/new`);
  await page.getByLabel("Document title").fill(title);
  await page.getByLabel(/Content/).fill(body);
  await expect(page.getByRole("button", { name: "Create document" })).toBeEnabled(ROUND_TRIP);
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page.getByRole("region", { name: "Document content" })).toBeVisible(ROUND_TRIP);
  await expect(page.locator("article").first()).toBeVisible(ROUND_TRIP);
  return { workspaceId, url: page.url() };
}

test.describe("wikilinks and backlinks in My Space", () => {
  test("a wikilink reaches its document, a missing one is marked, and the target lists what links to it", async ({ page }) => {
    const stamp = Date.now();
    const targetTitle = `Target Note ${stamp}`;
    const sourceTitle = `Source Note ${stamp}`;
    const target = await createMySpaceDocument(page, targetTitle, "The target document.");
    const source = await createMySpaceDocument(
      page,
      sourceTitle,
      `Intro line.\n\nSee [[${targetTitle}]] for the details, and [[No Such Note ${stamp}]] which does not exist yet.\n\nAlso [[${targetTitle}|the alias]].`,
    );

    // The source document: one link that goes somewhere, one that is marked, one with an alias.
    const article = page.locator("article").first();
    const link = article.getByRole("link", { name: targetTitle, exact: true });
    await expect(link).toBeVisible();
    await expect(article.getByRole("link", { name: "the alias" })).toBeVisible();
    const missing = article.locator("[data-unresolved-link]");
    await expect(missing).toHaveCount(1);
    await expect(missing).toHaveAttribute("title", `No document titled “No Such Note ${stamp}” in this workspace`);
    await expect(article.getByRole("link", { name: `No Such Note ${stamp}` })).toHaveCount(0);

    // Following it lands on the target, whose footer says who links here and where.
    await link.click();
    await expect(page).toHaveURL(target.url, ROUND_TRIP);
    const footer = page.locator("[data-backlinks]");
    await expect(footer.getByRole("heading", { name: "Linked from 1 document" })).toBeVisible(ROUND_TRIP);
    const backlink = footer.getByRole("link", { name: new RegExp(sourceTitle) });
    await expect(backlink).toContainText("×2");
    await expect(backlink).toContainText(`See ${targetTitle} for the details`);
    await backlink.click();
    await expect(page).toHaveURL(source.url, ROUND_TRIP);
  });

  test("the inspector's Links tab shows backlinks, outgoing and unresolved, and the palette opens it", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    const stamp = Date.now();
    const targetTitle = `Hub Note ${stamp}`;
    const otherTitle = `Other Note ${stamp}`;
    const target = await createMySpaceDocument(page, targetTitle, `Links out to [[${otherTitle}]] and [[Ghost ${stamp}]].`);
    await createMySpaceDocument(page, otherTitle, `Back to [[${targetTitle}]].`);
    await page.goto(target.url);

    // Opened from the command palette rather than by clicking the tab.
    await (await openPalette(page)).fill("backlinks");
    await page.getByRole("option", { name: /Show backlinks/ }).click();

    const links = page.getByRole("tab", { name: "Links", selected: true });
    await expect(links).toBeVisible();
    const backlinks = page.locator('[data-links-section="backlinks"]');
    await expect(backlinks).toContainText(otherTitle);
    await expect(backlinks).toContainText(`Back to ${targetTitle}`);
    await expect(page.locator('[data-links-section="outgoing"]')).toContainText(otherTitle);
    const unresolved = page.locator('[data-links-section="unresolved"]');
    await expect(unresolved).toContainText(`Ghost ${stamp}`);
  });

  test("a rename leaves the old name unresolved and the new one resolves", async ({ page }) => {
    const stamp = Date.now();
    const oldTitle = `Before Rename ${stamp}`;
    const newTitle = `After Rename ${stamp}`;
    const renamed = await createMySpaceDocument(page, oldTitle, "content");
    const linker = await createMySpaceDocument(page, `Renamer ${stamp}`, `Points at [[${oldTitle}]].`);
    await expect(page.locator("article").first().getByRole("link", { name: oldTitle })).toBeVisible();

    await page.goto(`${renamed.url}/edit`);
    await page.getByLabel("Title").fill(newTitle);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(renamed.url, ROUND_TRIP);

    // Nothing about the linking document was written, and what it points at changed.
    await page.goto(linker.url);
    await expect(page.locator("article").first().locator("[data-unresolved-link]")).toHaveCount(1);
    await expect(page.locator("article").first().getByRole("link", { name: oldTitle })).toHaveCount(0);
  });

  test("a heading in a link lands on that heading", async ({ page }) => {
    const stamp = Date.now();
    const targetTitle = `Anchored ${stamp}`;
    const target = await createMySpaceDocument(page, targetTitle, `Intro.\n\n## Setup\n\n${"filler paragraph\n\n".repeat(60)}## Local Setup\n\nHere.`);
    await createMySpaceDocument(page, `Anchor Linker ${stamp}`, `Go to [[${targetTitle}#Local Setup|the setup]].`);
    await page.locator("article").first().getByRole("link", { name: "the setup" }).click();
    await expect(page).toHaveURL(`${target.url}#local-setup`, ROUND_TRIP);
    await expect(page.locator("#local-setup")).toBeInViewport(ROUND_TRIP);
  });
});

test.describe("a shared document does not resolve links", () => {
  test.skip(!process.env.KM_PHASE3_APP_ROOT, "Run npm run test:e2e to provision the no-sign-in origin.");

  test("[[wikilinks]] on a /s/:token page read as text, with no link into the workspace", async ({ page, context, playwright }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const stamp = Date.now();
    const neighbour = `Neighbour ${stamp}`;
    await createMySpaceDocument(page, neighbour, "a neighbour that exists");
    await createMySpaceDocument(page, `Shared With Links ${stamp}`, `Reads [[${neighbour}]] and [[Nothing ${stamp}]] and [rel](../rel.md).`);

    await page.locator("main").getByRole("button", { name: "Share link…" }).click();
    const dialog = page.getByRole("dialog", { name: "Share link" });
    await dialog.getByRole("button", { name: "Create link" }).click();
    const item = dialog.locator("[data-share-link]").first();
    await expect(item).toBeVisible(ROUND_TRIP);
    const path = await item.getAttribute("data-share-link");

    const reader = await playwright.request.newContext({ baseURL: phase3UnconfiguredOrigin() });
    try {
      const html = await (await reader.get(path!)).text();
      expect(html).toContain(neighbour);
      expect(html).toContain(`Nothing ${stamp}`);
      // Text, not a link into a workspace the reader cannot open, and no
      // statement about which of these documents exist.
      expect(html).not.toContain("/w/");
      expect(html).not.toContain("data-unresolved-link");
      expect(html).not.toContain('href="../rel.md"');
    } finally {
      await reader.dispose();
    }
  });
});
