import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument, selectPassage } from "./fixtures/document-review";

test("comments stay compact until a reply is requested on desktop and mobile", async ({ page, request }) => {
  const markdown = "# Sharing knowledge\n\nKeep each document focused on one topic so that colleagues can find the answer quickly.\n\n## Writing guidelines\n\nStart with the decision or recommendation. Include a short example when it helps explain the next step.\n\nUse comments to ask questions and discuss changes before updating the document.";
  const doc = await createReviewDocument(request, markdown);
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await selectPassage(page, "one topic");
  await page.getByRole("button", { name: "Comment on selection" }).click();
  await page.getByRole("textbox", { name: "Add comment" }).fill("Could we add a short example here? It would help new colleagues get started.");
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  const thread = page.locator("[data-review-thread]").filter({ visible: true });
  await expect(thread).toContainText("Could we add a short example here?");
  await expect(thread.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByText("Current passage", { exact: true })).toHaveCount(0);
  await expect(page.getByText("0/3,000 characters", { exact: true })).toHaveCount(0);
  await thread.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(thread.getByRole("textbox", { name: "Reply" })).toBeFocused();
  await thread.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(thread.getByRole("textbox")).toHaveCount(0);
  await page.screenshot({ path: "/tmp/document-review-refined-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open discussions" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toHaveCSS("opacity", "1");
  await expect(drawer.getByRole("textbox")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/document-review-refined-mobile.png", fullPage: true });
});

test("mobile comments can retry after a temporary loading failure", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  let failOnce = true;
  await page.route("**/api/share-review/threads/query", async route => {
    if (failOnce) { failOnce = false; await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "AUTH_UNAVAILABLE" } }) }); }
    else await route.continue();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await page.getByRole("button", { name: "Open discussions" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("status")).toContainText("unavailable");
  await drawer.getByRole("button", { name: "Refresh discussions" }).click();
  await expect(drawer.getByRole("button", { name: "Comment on selection" })).toBeVisible();
  await expect(drawer.getByRole("status")).toHaveCount(0);
});

test("on a screen too narrow for the rail, discussions are reachable from anywhere in a long document", async ({ page, request }) => {
  const markdown = Array.from({ length: 120 }, (_, index) => `Paragraph ${index + 1} of a long document that a reader scrolls through.`).join("\n\n");
  const doc = await createReviewDocument(request, markdown);
  // A monitor turned to portrait: wide enough to read, too narrow for the reading column and a rail.
  await page.setViewportSize({ width: 1080, height: 1920 });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  const open = page.getByRole("button", { name: "Open discussions" });
  const article = page.locator("[data-review-document]").filter({ visible: true });
  await expect(article.locator("p")).toHaveCount(120);
  expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight * 2), "the document must be long enough to scroll").toBe(true);

  // Before any scrolling: on screen, above the text and not over it.
  await expect(open).toBeInViewport();
  const atTop = (await open.boundingBox())!;
  expect(atTop.y + atTop.height).toBeLessThanOrEqual((await article.boundingBox())!.y);

  // In the middle of the document it has followed the reader.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
  await expect(open).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await open.click();
  await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
});

test("on a wide screen the rail still sits beside the document, with no drawer button", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  const rail = page.getByRole("complementary", { name: "Document discussions" });
  const article = page.locator("[data-review-document]").filter({ visible: true });
  await expect(rail.getByRole("button", { name: "Comment on selection" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open discussions" })).toBeHidden();
  const railBox = (await rail.boundingBox())!;
  const articleBox = (await article.boundingBox())!;
  expect(railBox.x).toBeGreaterThanOrEqual(articleBox.x + articleBox.width - 1);
});
