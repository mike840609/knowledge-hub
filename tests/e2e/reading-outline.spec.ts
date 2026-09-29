import { expect, test, type Page } from "@playwright/test";

// Same budget and reasoning as phase5-authoring.spec.ts: create and save are a
// POST, a navigation and a server render.
const ROUND_TRIP = { timeout: 15_000 };

const filler = (count: number) =>
  Array.from({ length: count }, (_, index) => `Paragraph ${index} lorem ipsum dolor sit amet, consectetur adipiscing elit.`).join("\n\n");

/** Creates a document in the E2E user's own My Space and lands on it. */
async function createMySpaceDocument(page: Page, title: string, body: string): Promise<{ workspaceId: string }> {
  await page.goto("/");
  await page.waitForURL(/\/w\/[^/]+\/knowledge/);
  const workspaceId = new URL(page.url()).pathname.split("/")[2];
  await page.goto(`/w/${workspaceId}/knowledge/new`);
  await page.getByLabel("Document title").fill(title);
  await page.getByLabel(/Content/).fill(body);
  await expect(page.getByRole("button", { name: "Create document" })).toBeEnabled(ROUND_TRIP);
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page.getByRole("region", { name: "Document content" })).toBeVisible(ROUND_TRIP);
  return { workspaceId };
}

const longDocument = ["# Runbook", filler(6), "## 請假流程", filler(14), "## Setup", filler(14), "### Install", filler(14), "## Setup", filler(14), "## Usage", filler(3)].join("\n\n");

test.describe("document outline", () => {
  test("is a rail beside the content, follows the reader, and scrolls to a heading", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await createMySpaceDocument(page, `Outline ${Date.now()}`, longDocument);

    const rail = page.getByRole("complementary", { name: "On this page" });
    await expect(rail).toBeVisible();
    await expect(rail.getByRole("link")).toHaveText(["Runbook", "請假流程", "Setup", "Install", "Setup", "Usage"]);
    await expect(rail.getByRole("link", { name: "Runbook" })).toHaveAttribute("aria-current", "location");

    const historyBefore = await page.evaluate(() => window.history.length);
    await rail.getByRole("link", { name: "Install" }).click();
    await expect(page).toHaveURL(/#install$/);
    await expect(rail.getByRole("link", { name: "Install" })).toHaveAttribute("aria-current", "location");
    // Landed at the top of the pane, not left below the fold.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const pane = document.querySelector('[role="region"][aria-label="Document content"]');
          const heading = document.getElementById("install");
          return pane && heading ? Math.round(heading.getBoundingClientRect().top - pane.getBoundingClientRect().top) : null;
        }),
      )
      .toBeLessThan(40);
    // Following an outline entry is not a page visit: Back must leave the document.
    expect(await page.evaluate(() => window.history.length)).toBe(historyBefore);

    // A repeated heading gets its own anchor.
    await expect(page.locator("#setup")).toHaveCount(1);
    await expect(page.locator("#setup-1")).toHaveCount(1);

    // The last section is reachable and highlighted even though it is too short to reach the top.
    await page.getByRole("region", { name: "Document content" }).evaluate((pane) => pane.scrollTo({ top: pane.scrollHeight }));
    await expect(rail.getByRole("link", { name: "Usage" })).toHaveAttribute("aria-current", "location");
  });

  test("is a disclosure above the content when the pane is narrow, and a tab in the inspector", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await createMySpaceDocument(page, `Outline narrow ${Date.now()}`, longDocument);

    await expect(page.getByRole("complementary", { name: "On this page" })).toBeHidden();
    const disclosure = page.getByRole("group").filter({ hasText: "On this page" }).first();
    await disclosure.getByText("On this page").click();
    await disclosure.getByRole("link", { name: "請假流程" }).click();
    await expect(page).toHaveURL(/#%E8%AB%8B%E5%81%87%E6%B5%81%E7%A8%8B$/);

    await page.getByRole("button", { name: "Details" }).first().click();
    await page.getByRole("tab", { name: "Outline" }).click();
    await expect(page.getByRole("navigation", { name: "Document outline" }).getByRole("link")).toHaveCount(6);
  });

  test("a document with a single heading has no outline", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await createMySpaceDocument(page, `No outline ${Date.now()}`, "# Only one\n\nJust text.");
    await expect(page.getByRole("complementary", { name: "On this page" })).toHaveCount(0);
    await page.getByRole("button", { name: "Details" }).first().click();
    await expect(page.getByRole("tab", { name: "Outline" })).toHaveCount(0);
  });

  test("a historical revision shows that revision's outline", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const title = `Outline history ${Date.now()}`;
    await createMySpaceDocument(page, title, "## One\n\ntext\n\n## Two\n\ntext\n");
    const documentUrl = page.url();

    await page.goto(`${documentUrl}/edit`);
    await page.getByLabel("Markdown").fill("## One\n\ntext\n\n## Two\n\ntext\n\n## Three\n\ntext\n");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(documentUrl, ROUND_TRIP);

    const rail = page.getByRole("complementary", { name: "On this page" });
    await expect(rail.getByRole("link")).toHaveText(["One", "Two", "Three"]);
    await page.goto(`${documentUrl}?revision=1`);
    await expect(rail.getByRole("link")).toHaveText(["One", "Two"]);
  });
});
