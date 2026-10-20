import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId } from "./fixtures/my-space";

// share-page-outline spec §4.
const LONG = ["# Guide", "", "Intro.", "", "## Install", "", ...Array(40).fill("Step text.\n"), "## Configure", "", ...Array(40).fill("More text.\n"), "### Advanced", "", "End."].join("\n");

async function shareOf(page: Page, markdown: string) {
  const workspace = await personalWorkspaceId(page);
  const made = await page.request.post(`/api/workspaces/${workspace}/documents`, { data: { title: `Outline ${Date.now()}`, markdown } });
  expect(made.ok()).toBe(true);
  const { documentId } = await made.json();
  const shared = await page.request.post(`/api/documents/${documentId}/share-links`, { data: { label: "outline", expiresInDays: 1 } });
  expect(shared.status()).toBe(201);
  const { link } = (await shared.json()) as { link: { path: string } };
  return link.path;
}

const rail = (page: Page) => page.getByRole("complementary", { name: "On this page" });
const disclosure = (page: Page) => page.locator(".kh-share-outline summary", { hasText: "On this page" });

test("share outline: a rail left of the article on a wide window, jumping to headings", async ({ page }) => {
  const path = await shareOf(page, LONG);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(path);
  await expect(rail(page)).toBeVisible();
  await expect(disclosure(page)).toBeHidden();
  await expect(rail(page).getByRole("link")).toHaveText(["Guide", "Install", "Configure", "Advanced"]);
  const railBox = (await rail(page).boundingBox())!;
  const text = (await page.locator("article[data-review-document] p").first().boundingBox())!;
  expect(railBox.x + railBox.width).toBeLessThanOrEqual(text.x);
  expect(railBox.x).toBeGreaterThanOrEqual(0);

  await rail(page).getByRole("link", { name: "Configure" }).click();
  await expect(page).toHaveURL(/#configure$/);
  const heading = (await page.getByRole("heading", { name: "Configure" }).boundingBox())!;
  expect(heading.y).toBeLessThan(200);
  await expect(rail(page)).toBeInViewport();
});

test("share outline: a disclosure on a narrower window, and while comments are open", async ({ page }) => {
  const path = await shareOf(page, LONG);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(path);
  await expect(rail(page)).toBeHidden();
  await disclosure(page).click();
  await expect(page.getByRole("navigation", { name: "On this page" }).getByRole("link")).toHaveText(["Guide", "Install", "Configure", "Advanced"]);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(rail(page)).toBeVisible();
  await page.getByRole("button", { name: /^Open discussions/ }).click();
  await expect(rail(page)).toBeHidden();
  await expect(disclosure(page)).toBeVisible();
});

test("share outline: a document with one heading shows none", async ({ page }) => {
  const path = await shareOf(page, "# Only\n\nBody.");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(path);
  await expect(page.getByText("Body.")).toBeVisible();
  await expect(page.getByText("On this page")).toHaveCount(0);
});
