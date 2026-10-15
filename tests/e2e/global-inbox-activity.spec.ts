import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument } from "./fixtures/document-review";

test("owner Inbox shows a shared comment, retains activity after read, and links to its thread", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner");
  const viewer = phase3Origin("viewer");
  const token = doc.links[0].path.split("/").pop();
  const query = await (await request.post(`${viewer}/api/share-review/threads/query`, { headers: { Origin: viewer }, data: { token } })).json();
  const created = await request.post(`${viewer}/api/share-review/threads`, {
    headers: { Origin: viewer },
    data: {
      token, expectedRevisionId: query.revisionId,
      anchor: { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 2, endUtf16: 9, exact: "😀 bold", prefix: "A ", suffix: " passage to review." },
      body: "Inbox verification comment", idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(created.status()).toBe(201);
  const thread = await created.json();
  await page.goto(`${owner}/w/${doc.workspaceId}/inbox`);
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  const inbox = page.getByRole("list", { name: "Inbox discussions" });
  await expect(inbox.getByText("Inbox verification comment")).toBeVisible();
  await inbox.getByRole("listitem").filter({ hasText: "Inbox verification comment" }).getByRole("button", { name: "Mark read" }).click();
  await page.getByRole("tab", { name: "All activity" }).click();
  const activity = page.getByRole("list", { name: "Activity history" });
  const row = activity.getByRole("link", { name: /Inbox verification comment/ });
  await expect(row).toContainText("Read");
  await row.click();
  await expect(page).toHaveURL(new RegExp(`thread=${thread.id}`));
  await expect(page.getByRole("region", { name: "Discussion thread" }).getByText("Inbox verification comment", { exact: true })).toBeVisible();
});
