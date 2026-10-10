import { expect, test } from "@playwright/test";
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
