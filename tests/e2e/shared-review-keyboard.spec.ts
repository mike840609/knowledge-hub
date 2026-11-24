import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { phase3NoSessionOrigin, phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument } from "./fixtures/document-review";

// Read-only text cannot be selected from the keyboard, so a reader who may write reaches the composer
// through each paragraph's Comment button (inline review spec §2 item 6, 2026-11-24 amendment).
const MARKDOWN = "A first passage to review.\n\nA second paragraph here.";
const button = (page: Page, text: string) => page.getByRole("button", { name: `Comment on paragraph: ${text}`, exact: true });
const ready = (page: Page) => expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-ready", "");

/** One Tab from the title (the skip link's target) reaches the paragraph buttons: they are one stop. */
async function tabIn(page: Page, first: ReturnType<typeof button>) {
  await page.locator('[id="shared-content:skip"]').focus();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
}

test("a keyboard reader comments on a paragraph beside the open rail, without selecting text", async ({ page, request }) => {
  const doc = await createReviewDocument(request, MARKDOWN);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await ready(page);
  await page.getByRole("button", { name: /^Show comments/ }).click();
  const second = button(page, "A second paragraph here.");
  await tabIn(page, button(page, "A first passage to review."));
  await page.keyboard.press("ArrowDown");
  await expect(second).toBeFocused();
  // Shown while it has the keyboard's focus, in the article's left padding: the text keeps its place.
  await expect(second).toHaveCSS("opacity", "1");
  const paragraph = page.locator("[data-review-document]").getByText("A second paragraph here.", { exact: true });
  // Polled: the column may still be sliding left for the rail that just opened.
  await expect.poll(async () => { const [button, text] = [(await second.boundingBox())!, (await paragraph.boundingBox())!]; return button.x + button.width <= text.x + 0.5; }).toBe(true);
  await page.keyboard.press("Enter");
  const box = page.getByRole("textbox", { name: "Add comment" });
  await expect(box).toBeFocused();
  // The passage stays marked while the comment is written, and only then.
  const draftText = () => page.evaluate(() => Array.from((CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get("document-review-draft") ?? []).map(range => range.toString()));
  await expect.poll(draftText).toEqual(["A second paragraph here."]);
  await page.keyboard.type("Said from the keyboard");
  await page.keyboard.press("Control+Enter");
  await expect.poll(draftText).toEqual([]);
  await expect(page.locator("[data-review-rail] [data-review-thread]").filter({ hasText: "Said from the keyboard" })).toHaveCount(1);
  await expect(page.locator("[data-review-rail] [data-review-thread]").filter({ hasText: "Said from the keyboard" }).locator("blockquote")).toHaveText("A second paragraph here.");
});

test("on a phone the paragraph's button opens the composer in the drawer, focused", async ({ page, request }) => {
  const doc = await createReviewDocument(request, MARKDOWN);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await ready(page);
  const first = button(page, "A first passage to review.");
  await tabIn(page, first);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Comments" }).getByRole("textbox", { name: "Add comment" })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("the paragraph buttons are one tab stop: arrows move within them, Tab leaves", async ({ page, request }) => {
  const doc = await createReviewDocument(request, Array.from({ length: 40 }, (_, index) => `Paragraph ${index} of a long document.`).join("\n\n"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await ready(page);
  await expect(page.getByRole("toolbar", { name: "Paragraph comments" })).toHaveAttribute("aria-orientation", "vertical");
  await tabIn(page, button(page, "Paragraph 0 of a long document."));
  await page.keyboard.press("End");
  await expect(button(page, "Paragraph 39 of a long document.")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(button(page, "Paragraph 38 of a long document.")).toBeFocused();
  // One Tab leaves all forty behind.
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement && !document.activeElement.closest('[role="toolbar"]'))).toBe(true);
  // Shift+Tab comes back to the one last focused.
  await page.keyboard.press("Shift+Tab");
  await expect(button(page, "Paragraph 38 of a long document.")).toBeFocused();
});

test("a reader who may not write is offered no paragraph button", async ({ page, request }) => {
  const doc = await createReviewDocument(request, MARKDOWN);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${phase3NoSessionOrigin()}${doc.links[0].path}`);
  await ready(page);
  await expect(page.locator(".kh-block-comment-zone")).toHaveCount(0);
});
