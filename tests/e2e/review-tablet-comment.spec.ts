import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument, selectPassage } from "./fixtures/document-review";
// Tablet widths, where the discussions are a drawer: the reader selects first, and the bubble opens
// the drawer with the composer (phone width is review-layout.spec.ts).
for (const width of [900, 768])
  test(`reader comments by selecting text at ${width}px`, async ({ page, request }) => {
    const doc = await createReviewDocument(request);
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
    await expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-ready", "");
    await selectPassage(page);
    await page.getByRole("button", { name: "Comment on selection" }).first().click();
    await page.getByRole("textbox", { name: "Add comment" }).fill("Narrow words");
    await page.getByRole("button", { name: "Add comment", exact: true }).click();
    await expect(page.locator("[data-review-thread]").filter({ visible: true }).getByText("Narrow words", { exact: true })).toBeVisible();
  });
