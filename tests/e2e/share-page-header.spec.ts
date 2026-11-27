import { expect, test } from "./fixtures/test";
import { phase3Origin, phase3UserId } from "./fixtures/phase3-identities";
import { createReviewDocument } from "./fixtures/document-review";

// Spec 2026-10-09, amendment 2026-10-22: the expiry is quiet until its last three days.
test("a link's expiry is quiet a month out, and said with emphasis and how soon in its last day", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner"), viewer = phase3Origin("viewer");
  const created = await request.post(`${owner}/api/documents/${doc.documentId}/share-links`, { data: { label: "Short", expiresInDays: 1 } });
  expect(created.ok()).toBe(true);
  const short = (await created.json()).link;

  await page.goto(`${viewer}${doc.links[0].path}`);
  const expiry = page.getByText(/^Link expires/);
  await expect(expiry).not.toContainText("(in");
  await expect(expiry).not.toHaveClass(/text-kh-warning/);

  await page.goto(`${viewer}${short.path}`);
  await expect(expiry).toContainText("(in less than a day)");
  await expect(expiry).toHaveClass(/text-kh-warning/);
});

/** Where a control is once nothing is sliding: two reads a frame apart that agree. */
async function settledX(locator: import("@playwright/test").Locator): Promise<number> {
  let last = Number.NaN;
  await expect.poll(async () => { const x = (await locator.boundingBox())!.x; const same = Math.abs(x - last) < 0.5; last = x; return same; }).toBe(true);
  return last;
}

// Spec 2026-10-09, §4.0.1 (amended 2026-11-24): opening the rail leaves the bar's buttons under the pointer.
for (const width of [1200, 1280, 1440]) {
  test(`at ${width}px opening and closing the comments leaves Comments and Download where they were`, async ({ page, request }) => {
    const doc = await createReviewDocument(request);
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
    await expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-ready", "");
    const comments = page.getByRole("button", { name: /^Comments\b/ });
    const download = page.getByRole("button", { name: /^Download/ });
    const brand = page.getByText("Knowledge Hub", { exact: true }).first();
    const text = page.locator("[data-review-document] p").first();
    const [commentsX, downloadX] = [await settledX(comments), await settledX(download)];
    await comments.click();
    await expect(comments).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("complementary", { name: "Document comments" })).toBeVisible();
    expect(Math.abs(await settledX(comments) - commentsX)).toBeLessThan(1);
    expect(Math.abs(await settledX(download) - downloadX)).toBeLessThan(1);
    // The brand still starts where the text does, which may have moved left for the rail.
    expect(Math.abs(await settledX(brand) - await settledX(text))).toBeLessThan(1);
    await comments.click();
    await expect(comments).toHaveAttribute("aria-expanded", "false");
    expect(Math.abs(await settledX(comments) - commentsX)).toBeLessThan(1);
  });
}

test("in the Hub's reader the shared page's Download stays where it was when the comments open", async ({ page, request }) => {
  const recipient = phase3Origin("nonCreator");
  const workspace = (await (await request.get(`${recipient}/api/workspaces`)).json()).items.find((item: { type: string }) => item.type === "PERSONAL").id;
  const doc = await createReviewDocument(request);
  const created = await request.post(`${phase3Origin("reviewOwner")}/api/documents/${doc.documentId}/share-links`, { data: { label: "named", recipients: [phase3UserId("nonCreator")] } });
  expect(created.ok()).toBe(true);
  const token = (await created.json()).link.path.slice("/s/".length);
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto(`${recipient}/w/${workspace}/shares/${token}`);
  await expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-ready", "");
  const comments = page.getByRole("button", { name: /^Comments\b/ });
  const download = page.getByRole("button", { name: /^Download/ });
  const [commentsX, downloadX] = [await settledX(comments), await settledX(download)];
  await comments.click();
  await expect(comments).toHaveAttribute("aria-expanded", "true");
  expect(Math.abs(await settledX(comments) - commentsX)).toBeLessThan(1);
  expect(Math.abs(await settledX(download) - downloadX)).toBeLessThan(1);
});
