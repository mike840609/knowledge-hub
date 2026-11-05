import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument } from "./fixtures/document-review";
import { chooseOption, expectChosen } from "./fixtures/select-menu";

// The index is a client fetch; a loaded CI box needs more than the default expect timeout.
const LOADED = { timeout: 15_000 };

test("owner Inbox is a discussion index, one row per discussion, settled and filtered", async ({ page, request }) => {
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
  // The owner's Inbox is every document's; this run may already hold other specs' discussions.
  const title: string = (await (await request.get(`${owner}/api/documents/${doc.documentId}/peek?brief`)).json()).title;

  // The page opens on the whole index: one row for the discussion, no second count, the `All` tab.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${owner}/w/${doc.workspaceId}/inbox`);
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(page.getByText("Inbox ·")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "All", exact: true })).toHaveAttribute("aria-selected", "true");
  const inbox = page.getByRole("list", { name: "Inbox discussions" });
  const rows = inbox.getByRole("listitem").filter({ hasText: title });
  await expect(rows).toHaveCount(1, LOADED);
  await expect(rows.first()).toContainText("Inbox verification comment");

  // The row's own Mark read settles the thread without selecting it.
  const markRead = rows.first().getByRole("button", { name: /^Mark read:/ });
  await expect(markRead).toBeVisible(LOADED);
  await markRead.click();
  await expect(markRead).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Selected discussion" })).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]item=/);

  // A second comment on the same thread is still one row, showing the newest line and every comment.
  const replied = await request.post(`${viewer}/api/share-review/threads/${thread.id}/replies`, {
    headers: { Origin: viewer },
    data: { token, body: "A second reader comment", idempotencyKey: crypto.randomUUID() },
  });
  expect(replied.status()).toBe(200);
  await page.reload();
  await expect(rows).toHaveCount(1, LOADED);
  await expect(rows.first()).toContainText("A second reader comment");
  await expect(rows.first()).toContainText("2 comments");
  // The new comment is unread again: the per-row control returns without a second count on the page.
  await expect(rows.first().getByRole("button", { name: /^Mark read:/ })).toBeVisible(LOADED);

  // Selecting the row opens the discussion beside the list and marks it read.
  await rows.first().getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`[?&]item=${thread.id}(&|$)`));
  const selected = page.getByRole("region", { name: "Selected discussion" });
  const card = selected.getByRole("region", { name: "Discussion thread" });
  await expect(card.getByText("Inbox verification comment", { exact: true })).toBeVisible(LOADED);
  await expect(card.getByText("A second reader comment", { exact: true })).toBeVisible(LOADED);
  await card.getByRole("button", { name: "Reply", exact: true }).click();
  await card.getByRole("textbox", { name: "Reply", exact: true }).fill("Answered from the Inbox");
  await card.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(card.getByText("Answered from the Inbox", { exact: true })).toBeVisible();
  // The reply settles the row it is about: no Refresh, and the count follows the pane.
  await expect(rows.first()).toContainText("3 comments");

  // Resolving under the `Open` filter leaves the selected row in place, saying `Resolved`.
  await chooseOption(page.getByLabel("Status"), "open");
  await expect(page).toHaveURL(/[?&]status=open/);
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByRole("link")).toHaveAttribute("aria-current", "true");
  await card.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(rows.first()).toContainText("Resolved");
  await expectChosen(page.getByLabel("Status"), "open");
  await expect(rows.first().getByRole("link")).toHaveAttribute("aria-current", "true");

  // The document stays one click away, on its own discussion.
  await selected.getByRole("link", { name: "Open document" }).click();
  await expect(page).toHaveURL(new RegExp(`thread=${thread.id}`));
  const opened = page.getByRole("region", { name: "Discussion thread" });
  await expect(opened.getByText("Inbox verification comment", { exact: true })).toBeVisible(LOADED);
  await expect(opened.getByText("Answered from the Inbox", { exact: true })).toBeVisible(LOADED);

  // The relationship tabs are over the same index; this discussion is neither followed nor mentioned.
  await page.goto(`${owner}/w/${doc.workspaceId}/inbox`);
  await page.getByRole("tab", { name: "Following", exact: true }).click();
  await expect(page).toHaveURL(/[?&]kind=follow/);
  await expect(page.getByText("No discussions match these filters.", { exact: true })).toBeVisible(LOADED);
  await page.getByRole("tab", { name: "Mentions", exact: true }).click();
  await expect(page).toHaveURL(/[?&]kind=mention/);
  await expect(page.getByText("No discussions match these filters.", { exact: true })).toBeVisible(LOADED);
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await expect(rows).toHaveCount(1, LOADED);
  await expect(rows.first()).toContainText("A second reader comment");

  // Narrow, the same index is a plain list whose rows open the document; there is no pane.
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto(`${owner}/w/${doc.workspaceId}/inbox`);
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Selected discussion" })).toHaveCount(0);
  await rows.first().getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`thread=${thread.id}`));
});
