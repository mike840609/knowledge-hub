import { expect, test } from "./fixtures/test";
import { phase3NoSessionOrigin, phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument, openReviewDiscussions, selectPassage } from "./fixtures/document-review";

const SHORTCUT = "Meta+Alt+M Control+Alt+M";

test("Ctrl+Alt+M comments on the selected text of a shared page", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await openReviewDiscussions(page);
  // Named on the panel's button, and in its tooltip.
  const button = page.getByRole("button", { name: "Comment on selected text" });
  await expect(button).toHaveAttribute("aria-keyshortcuts", SHORTCUT);
  await button.hover();
  await expect(page.getByText("⌘⌥M", { exact: true })).toBeVisible();
  // With nothing selected in the document the key does nothing.
  await page.locator("body").press("Control+Alt+KeyM");
  await expect(page.getByRole("textbox", { name: "Add comment" })).toHaveCount(0);
  await selectPassage(page);
  await page.keyboard.press("Control+Alt+KeyM");
  const composer = page.getByRole("textbox", { name: "Add comment" });
  await expect(composer).toBeFocused();
  await expect(page.locator(".kh-review-composer blockquote")).toHaveText("😀 bold");
});

test("Ctrl+Alt+M in the owner's editor comments on its selection", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(doc.href);
  const surface = page.getByRole("textbox", { name: "Content", exact: true });
  await expect(surface).toBeEditable({ timeout: 15_000 });
  await expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-ready", "");
  await surface.click();
  await selectPassage(page);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("😀 bold");
  await expect(page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Comment on selection" })).toHaveAttribute("aria-keyshortcuts", SHORTCUT);
  await page.keyboard.press("Control+Alt+KeyM");
  const composer = page.getByRole("textbox", { name: "Add comment" });
  await expect(composer).toBeFocused();
  await expect(page.locator(".kh-review-composer blockquote")).toHaveText("😀 bold");
  // The key wrote nothing into the document.
  await expect(surface).toContainText("A 😀 bold passage to review.");
});

test("an anonymous reader's Ctrl+Alt+M leaves them on the page", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${phase3NoSessionOrigin()}${doc.links[0].path}`);
  await expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-ready", "");
  const before = page.url();
  await selectPassage(page);
  await expect(page.locator(".kh-selection-bubble").getByRole("link", { name: "Sign in to comment" })).toBeVisible();
  await page.keyboard.press("Control+Alt+KeyM");
  await expect(page.getByRole("textbox", { name: "Add comment" })).toHaveCount(0);
  expect(page.url()).toBe(before);
});
