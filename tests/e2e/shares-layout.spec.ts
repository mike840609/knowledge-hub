import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument } from "./fixtures/document-review";

test("the Shares sections keep their tab row at the same height", async ({ page, request }) => {
  const origin = phase3Origin("reviewOwner");
  const doc = await createReviewDocument(request);
  await page.setViewportSize({ width: 390, height: 844 });
  const sections = [
    { path: "", description: "Manage links to your documents and folders." },
    { path: "?tab=saved", description: "Keep articles shared with you within reach." },
    { path: "?tab=discussions", description: "Discussions you follow on shared articles." },
  ];
  const tops: number[] = [];
  for (const section of sections) {
    await page.goto(`${origin}/w/${doc.workspaceId}/shares${section.path}`);
    const nav = page.getByRole("navigation", { name: "Shares sections" });
    await expect(nav).toBeVisible();
    await expect(page.getByText(section.description, { exact: false })).toBeVisible();
    tops.push((await nav.boundingBox())!.y);
  }
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
});

test("a long Shares list scrolls the pane, not the document", async ({ page, request }) => {
  const origin = phase3Origin("reviewOwner");
  const docs = await Promise.all(Array.from({ length: 8 }, () => createReviewDocument(request)));
  const doc = docs[0];
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto(`${origin}/w/${doc.workspaceId}/shares`);
  const main = page.locator("#kh-workspace-main");
  // A preceding test's shares stay in the database, so only the pane overflowing matters here.
  await expect.poll(() => main.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  const before = await page.evaluate(() => ({
    documentHeight: document.documentElement.scrollHeight,
    windowHeight: document.documentElement.clientHeight,
  }));
  expect(before.documentHeight).toBe(before.windowHeight);
  await page.evaluate(() => window.scrollTo(0, 500));
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await main.evaluate((element) => { element.scrollTop = 300; });
  expect(await main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});
