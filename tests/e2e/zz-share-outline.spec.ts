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

test("share outline: a rail right of the article on a wide window, jumping to headings", async ({ page }) => {
  const path = await shareOf(page, LONG);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(path);
  await expect(rail(page)).toBeVisible();
  await expect(disclosure(page)).toBeHidden();
  await expect(rail(page).getByRole("link")).toHaveText(["Guide", "Install", "Configure", "Advanced"]);
  const railBox = (await rail(page).boundingBox())!;
  const text = (await page.locator("article[data-review-document] p").first().boundingBox())!;
  expect(railBox.x).toBeGreaterThanOrEqual(text.x + text.width);
  expect(railBox.x + railBox.width).toBeLessThanOrEqual(1440);

  await expect(rail(page).getByRole("link", { name: "Guide" })).toHaveAttribute("aria-current", "location");
  const historyBefore = await page.evaluate(() => window.history.length);
  await rail(page).getByRole("link", { name: "Configure" }).click();
  await expect(page).toHaveURL(/#configure$/);
  // The outline's own scroll, not the link's jump: the address is replaced, so Back leaves the page.
  expect(await page.evaluate(() => window.history.length)).toBe(historyBefore);
  await expect(rail(page).getByRole("link", { name: "Configure" })).toHaveAttribute("aria-current", "location");
  await expect(rail(page)).toBeInViewport();
  await expectBelowCommentsBar(page, "Configure");
});

test("share outline: the current entry follows the window's scroll", async ({ page }) => {
  const path = await shareOf(page, LONG);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(path);
  await page.evaluate(() => window.scrollTo({ top: document.getElementById("install")!.getBoundingClientRect().top + window.scrollY - 80 }));
  await expect(rail(page).getByRole("link", { name: "Install" })).toHaveAttribute("aria-current", "location");
  await expect(rail(page).locator("[aria-current]")).toHaveCount(1);
  // A short last section never reaches the reading line; at the bottom it is the current one.
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
  await expect(rail(page).getByRole("link", { name: "Advanced" })).toHaveAttribute("aria-current", "location");

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await disclosure(page).click();
  const list = page.getByRole("navigation", { name: "On this page" });
  await expect(list.getByRole("link", { name: "Guide" })).toHaveAttribute("aria-current", "location");
  await list.getByRole("link", { name: "Install" }).click();
  await expect(list.getByRole("link", { name: "Install" })).toHaveAttribute("aria-current", "location");
  await expectBelowCommentsBar(page, "Install");
});

/** A heading jumped to is in full view under the pinned Comments bar, not behind it. */
async function expectBelowCommentsBar(page: Page, name: string) {
  const bar = page.locator(".kh-review-entry");
  const heading = page.getByRole("heading", { name, exact: true });
  await expect.poll(async () => {
    const [barBox, headingBox] = [(await bar.boundingBox())!, (await heading.boundingBox())!];
    return headingBox.y >= barBox.y + barBox.height && headingBox.y < 200;
  }).toBe(true);
  await expect(heading).toBeInViewport();
}

test("share outline: a disclosure on a narrower window, and while comments are open", async ({ page }) => {
  const path = await shareOf(page, LONG);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(path);
  await expect(rail(page)).toBeHidden();
  await disclosure(page).click();
  await expect(page.getByRole("navigation", { name: "On this page" }).getByRole("link")).toHaveText(["Guide", "Install", "Configure", "Advanced"]);
  // The box is as wide as the text under it, not the 860px column (reader-measure spec §1).
  const box = (await page.locator(".kh-share-outline details").boundingBox())!;
  const text = (await page.locator("article[data-review-document] p").first().boundingBox())!;
  expect(box.x).toBeCloseTo(text.x, 0);
  expect(box.width).toBeLessThanOrEqual(640);

  // Under 82rem the comments rail is inline, and the outline stays the disclosure above the article.
  await page.getByRole("button", { name: /^Open discussions/ }).click();
  await expect(page.getByRole("complementary", { name: "Document discussions" })).toBeVisible();
  await expect(rail(page)).toBeHidden();
  await expect(disclosure(page)).toBeVisible();
});

test("share outline: from 82rem the article, the comments and the outline stand side by side", async ({ page }) => {
  const path = await shareOf(page, LONG);
  // 1312 is 82rem, where the column slides furthest; 1680 is past 1604px, where it does not slide at all.
  for (const width of [1312, 1366, 1440, 1680]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(path);
    const comments = page.getByRole("complementary", { name: "Document discussions" });
    await expect(rail(page)).toBeVisible();
    await page.getByRole("button", { name: /^Open discussions/ }).click();
    await expect(comments).toBeVisible();
    await expect(rail(page)).toBeVisible();
    await expect(disclosure(page)).toBeHidden();
    // Wait for the column's 120ms slide; then article, comments, outline, in that order, all on screen.
    await expect.poll(async () => {
      const [outline, commentsBox, text] = [await rail(page).boundingBox(), await comments.boundingBox(), await page.locator("article[data-review-document] p").first().boundingBox()];
      if (!outline || !commentsBox || !text) return false;
      return commentsBox.x >= text.x + text.width - 1 && outline.x >= commentsBox.x + commentsBox.width - 1 && outline.x + outline.width <= width;
    }).toBe(true);
    // 640px of measure less the 32px the marks keep.
    expect((await page.locator("article[data-review-document] p").first().boundingBox())!.width).toBeGreaterThanOrEqual(608);
  }
});

test("share outline: opening comments on a wide window leaves the article where it was", async ({ page }) => {
  const path = await shareOf(page, LONG);
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(path);
  const articleX = async () => Math.round((await page.locator("article[data-review-document]").boundingBox())!.x);
  const before = await articleX();
  await page.getByRole("button", { name: /^Open discussions/ }).click();
  await expect(page.getByRole("complementary", { name: "Document discussions" })).toBeVisible();
  await page.waitForTimeout(250);
  expect(await articleX()).toBe(before);
});

test("share outline: a document with one heading shows none", async ({ page }) => {
  const path = await shareOf(page, "# Only\n\nBody.");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(path);
  await expect(page.getByText("Body.")).toBeVisible();
  await expect(page.getByText("On this page")).toHaveCount(0);
});

test("share outline: a long heading wraps to two lines in the outline rather than being cut to one", async ({ page }) => {
  const long = "這是一個相當長的中文章節標題用來確認目錄可以顯示兩行而不是被截斷成單行省略";
  const path = await shareOf(page, `# Guide\n\nIntro.\n\n## ${long}\n\nBody.\n\n## Short\n\nEnd.`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(path);
  const entry = rail(page).getByRole("link", { name: long });
  const short = (await rail(page).getByRole("link", { name: "Short" }).boundingBox())!;
  const box = (await entry.boundingBox())!;
  expect(box.height).toBeGreaterThan(short.height * 1.5);
  expect(box.height).toBeLessThan(short.height * 2.6);
});
