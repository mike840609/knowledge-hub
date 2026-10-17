import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument, selectPassage } from "./fixtures/document-review";

const ROUND_TRIP = { timeout: 15_000 };

for (const width of [1680, 900, 390]) {
  test(`inline comments share the formatting toolbar and restore the passage after Escape at ${width}px`, async ({ page, request }, testInfo) => {
    const doc = await createReviewDocument(request);
    expect(new URL(doc.href).origin).toBe(phase3Origin("reviewOwner"));
    await page.setViewportSize({ width, height: 900 });
    await page.goto(doc.href);
    const surface = page.getByRole("textbox", { name: "Content", exact: true });
    await expect(surface).toBeEditable(ROUND_TRIP);
    await expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-ready", "");
    // Select the same passage deterministically at every viewport. The editor's
    // keyboard navigation is covered separately; this case checks that opening
    // and cancelling the draft preserves the selected range.
    await selectPassage(page);
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("😀 bold");
    const toolbar = page.getByRole("toolbar", { name: "Formatting" });
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toHaveCSS("opacity", "1");
    const toolbarBox = (await toolbar.boundingBox())!;
    expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`selection-toolbar-${width}.png`) });
    const comment = toolbar.getByRole("button", { name: "Comment on selection" });
    if (width === 900) {
      for (let index = 0; index < 9; index++) await page.keyboard.press("Tab");
      await expect(comment).toBeFocused();
      await page.keyboard.press("Enter");
    } else await comment.click();
    await expect(page.locator(".kh-selection-bubble")).toHaveCount(0);
    const box = page.getByRole("textbox", { name: "Add comment" });
    await expect(box).toBeFocused();
    await box.fill("A draft comment");
    if (width === 1680) {
      await expect.poll(async () => {
        const bounds = (await page.locator(".kh-review-panel").boundingBox())!;
        return Math.ceil(bounds.x + bounds.width);
      }).toBeLessThanOrEqual(width);
    }
    await page.screenshot({ path: testInfo.outputPath(`comment-draft-${width}.png`) });
    await expect(box).toBeFocused();
    await box.press("Escape");
    await expect(box).toHaveCount(0);
    await expect(surface).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("😀 bold");
    await expect(surface).toContainText("A 😀 bold passage to review.");
  });
}

test("a comment pins freshly edited text, waits for document saving, and submits against the acknowledged revision", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(doc.href);
  const surface = page.getByRole("textbox", { name: "Content", exact: true });
  await expect(surface).toBeEditable(ROUND_TRIP);
  await expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-ready", "");
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let savedRevision = "";
  await page.route(`**/api/documents/${doc.documentId}`, async route => {
    if (route.request().method() !== "PATCH") return route.continue();
    const response = await route.fetch();
    savedRevision = (await response.json()).revisionId;
    await held;
    await route.fulfill({ response });
  });
  try {
    await surface.fill("Updated 😀 bold passage to review.");
    await selectPassage(page);
    await page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Comment on selection" }).click();
    const box = page.getByRole("textbox", { name: "Add comment" });
    await expect(box).toBeFocused();
    await box.fill("Comment while the document saves");
    await expect(page.getByRole("status").filter({ hasText: "Saving document before commenting" })).toBeVisible();
    const submit = page.getByRole("button", { name: "Add comment", exact: true });
    await expect(submit).toBeDisabled();
    release();
    await expect(submit).toBeEnabled(ROUND_TRIP);
    await expect(box).toHaveValue("Comment while the document saves");
    await expect(box).toBeFocused();
    const posting = page.waitForRequest(req => req.url().endsWith(`/api/documents/${doc.documentId}/review-threads`) && req.method() === "POST");
    await submit.click();
    expect((await posting).postDataJSON()).toMatchObject({ expectedRevisionId: savedRevision, anchor: { exact: "😀 bold", startUtf16: 8, endUtf16: 15 } });
    await expect(page.getByText("Comment while the document saves", { exact: true }).filter({ visible: true })).toBeVisible(ROUND_TRIP);
    await expect(page.locator("[data-review-marker]")).toHaveCount(1);
  } finally { release(); }
});

test("a failed document save keeps the comment draft and allows an explicit retry", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(doc.href);
  const surface = page.getByRole("textbox", { name: "Content", exact: true });
  await expect(surface).toBeEditable(ROUND_TRIP);
  await expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-ready", "");
  let fail = true;
  await page.route(`**/api/documents/${doc.documentId}`, route => route.request().method() === "PATCH" && fail
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "UNAVAILABLE", message: "Document save unavailable" } }) }) : route.continue());
  await surface.fill("Edited 😀 bold passage.");
  await selectPassage(page);
  await page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Comment on selection" }).click();
  const box = page.getByRole("textbox", { name: "Add comment" });
  await box.fill("Keep my comment draft");
  await expect(page.getByRole("button", { name: "Retry document save" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add comment", exact: true })).toBeDisabled();
  fail = false;
  await page.getByRole("button", { name: "Retry document save" }).click();
  await expect(page.getByRole("button", { name: "Add comment", exact: true })).toBeEnabled(ROUND_TRIP);
  await expect(box).toHaveValue("Keep my comment draft");
});
