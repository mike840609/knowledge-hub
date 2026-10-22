import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
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
