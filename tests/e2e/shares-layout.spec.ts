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
