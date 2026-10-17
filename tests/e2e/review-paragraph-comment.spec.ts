import { expect, test } from "./fixtures/test";
import { createReviewDocument } from "./fixtures/document-review";

// A paragraph's comment button, for the owner of a document: beside the paragraph, in the reading
// column's own padding, so the article keeps the width the rail's design gives it
// (docs/superpowers/specs/2026-10-12-owner-comments-rail-design.md).
const button = (page: import("@playwright/test").Page, text: string) => page.getByRole("button", { name: `Comment on paragraph: ${text}`, exact: true });
const ready = async (page: import("@playwright/test").Page) => {
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toBeVisible();
  await expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-ready", "");
};

test("the owner comments on a paragraph from the button beside it, and the article keeps its width", async ({ page, request }) => {
  const doc = await createReviewDocument(request, "## Alpha\n\nA paragraph.\n\n## Beta\n\nAnother.\n");
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(doc.href);
  await ready(page);
  const article = page.locator("[data-review-document]");
  const paragraph = article.getByText("A paragraph.", { exact: true });
  const before = (await article.boundingBox())!;
  const comment = button(page, "A paragraph.");
  await expect(comment).toHaveCount(1);
  // Not shown until the paragraph is pointed at; and it stands outside the article, which has no margin made for it.
  await expect(comment).toHaveCSS("opacity", "0");
  await paragraph.hover();
  await expect(comment).toHaveCSS("opacity", "1");
  expect(await article.evaluate((element) => getComputedStyle(element).paddingRight)).toBe("0px");
  expect((await article.boundingBox())!).toEqual(before);
  expect((await comment.boundingBox())!.x).toBeGreaterThanOrEqual(before.x + before.width);

  await comment.click();
  await expect(paragraph).toHaveClass(/kh-comment-block-selected/);
  const box = page.getByRole("textbox", { name: "Add comment" });
  await expect(box).toBeFocused();
  await box.fill("About this paragraph");
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await expect(page.getByText("About this paragraph", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(paragraph).not.toHaveClass(/kh-comment-block-selected/);
  // The discussion is anchored to that paragraph's words: it has a marker beside it.
  await expect(page.locator("[data-review-marker]")).toHaveCount(1);
});

test("where the pane has no room for a rail, the paragraph's button opens the comment in the drawer", async ({ page, request }) => {
  const doc = await createReviewDocument(request, "A paragraph.\n\nAnother.\n");
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto(doc.href);
  await ready(page);
  await page.locator("[data-review-document]").getByText("Another.", { exact: true }).hover();
  await button(page, "Another.").click();
  const drawer = page.getByRole("dialog", { name: "Comments" });
  await expect(drawer.getByRole("textbox", { name: "Add comment" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("a paragraph in a closed disclosure has no button until it is opened", async ({ page, request }) => {
  const doc = await createReviewDocument(request, "Outside.\n\n<details>\n<summary>More</summary>\n\nInside the disclosure.\n\n</details>\n");
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(doc.href);
  await ready(page);
  await expect(button(page, "Outside.")).toHaveCount(1);
  await expect(button(page, "Inside the disclosure.")).toHaveCount(0);
  await page.locator("[data-review-document] summary").click({ position: { x: 5, y: 8 } });
  await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", { timeout: 15000 });
  await expect(button(page, "Inside the disclosure.")).toHaveCount(1);
});

test("a long document gets its buttons without holding the page up", async ({ page, request }) => {
  const markdown = Array.from({ length: 300 }, (_, index) => `Paragraph number ${index} of a long document, with enough words to be a sentence.`).join("\n\n");
  const doc = await createReviewDocument(request, markdown);
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(doc.href);
  await ready(page);
  const started = Date.now();
  await expect(page.locator(".kh-block-comment-zone")).toHaveCount(300, { timeout: 5_000 });
  // Projecting the document once per paragraph took seconds for this many; once for all does not.
  expect(Date.now() - started).toBeLessThan(5_000);
});
