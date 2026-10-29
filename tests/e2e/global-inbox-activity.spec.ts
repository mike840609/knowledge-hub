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
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${owner}/w/${doc.workspaceId}/inbox`);
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  const inbox = page.getByRole("list", { name: "Inbox discussions" });
  await expect(inbox.getByText("Inbox verification comment")).toBeVisible();
  await inbox.getByRole("listitem").filter({ hasText: "Inbox verification comment" }).getByRole("button", { name: "Mark read" }).click();
  await page.getByRole("tab", { name: "All activity" }).click();
  const activity = page.getByRole("list", { name: "Activity history" });
  const row = activity.getByRole("link", { name: /Inbox verification comment/ });
  await expect(row).toContainText("Read");
  // Selected, the discussion sits beside the list and takes a reply there.
  await row.click();
  await expect(page).toHaveURL(/[?&]item=/);
  const selected = page.getByRole("region", { name: "Selected discussion" });
  await expect(selected.getByText("Inbox verification comment", { exact: true })).toBeVisible();
  await selected.getByRole("button", { name: "Reply" }).click();
  await selected.getByRole("textbox", { name: "Reply" }).fill("Answered from the Inbox");
  await selected.getByRole("button", { name: "Reply" }).last().click();
  await expect(selected.getByText("Answered from the Inbox", { exact: true })).toBeVisible();
  await selected.getByRole("link", { name: "Open document" }).click();
  await expect(page).toHaveURL(new RegExp(`thread=${thread.id}`));
  const card = page.getByRole("region", { name: "Discussion thread" });
  await expect(card.getByText("Inbox verification comment", { exact: true })).toBeVisible();
  await expect(card.getByText("Answered from the Inbox", { exact: true })).toBeVisible();

  // Narrow, the Inbox is a list whose rows open the document.
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto(`${owner}/w/${doc.workspaceId}/inbox`);
  await page.getByRole("tab", { name: "All activity" }).click();
  await expect(page.getByRole("region", { name: "Selected discussion" })).toHaveCount(0);
  await page.getByRole("list", { name: "Activity history" }).getByRole("link", { name: /Inbox verification comment/ }).click();
  await expect(page).toHaveURL(new RegExp(`thread=${thread.id}`));
});
