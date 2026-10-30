import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument, openReviewDiscussions, selectPassage } from "./fixtures/document-review";

const ANCHOR = { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 2, endUtf16: 9, exact: "😀 bold", prefix: "A ", suffix: " passage to review." };

async function personalWorkspaceId(request: APIRequestContext, origin: string): Promise<string> {
  const navigation = await (await request.get(`${origin}/api/workspaces`)).json();
  return navigation.items.find((item: { type: string }) => item.type === "PERSONAL").id;
}

// Spec 2026-10-29: a reader pulls someone new into a shared discussion with `@`; the person
// mentioned finds it in their Inbox, opens the shared page on it, and then follows its replies.
test("a reader mentions someone new on the shared page; the mention and the next reply reach that person's Inbox", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const token = doc.links[0].path.split("/").pop()!;
  const viewer = phase3Origin("viewer"), mentioned = phase3Origin("groupAdmin");
  // Start the mentioned person's Inbox empty, so its badge counts this test's entry alone.
  expect((await request.post(`${mentioned}/api/review-notifications/activity`, { headers: { Origin: mentioned }, data: { action: "mark-all-read" } })).ok()).toBe(true);

  // The reader writes the mention with the keyboard.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${viewer}${doc.links[0].path}`);
  await openReviewDiscussions(page);
  await selectPassage(page);
  await page.getByRole("button", { name: "Comment on selection" }).click();
  const composer = page.getByRole("textbox", { name: "Add comment" });
  await composer.click();
  await composer.pressSequentially("Please look @groupAd");
  const options = page.getByRole("listbox", { name: "People to mention" }).getByRole("option");
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText("Phase3 groupAdmin");
  await expect(options.first()).toContainText("P3-106");
  await composer.press("ArrowDown");
  await composer.press("Enter");
  await expect(page.getByRole("listbox", { name: "People to mention" })).toHaveCount(0);
  await expect(composer).toHaveValue("Please look @Phase3 groupAdmin ");
  await composer.pressSequentially("at this");
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  const body = "Please look @Phase3 groupAdmin at this";
  await expect(page.locator("[data-review-thread]").getByText(body, { exact: true })).toBeVisible();
  const query = await (await request.post(`${viewer}/api/share-review/threads/query`, { headers: { Origin: viewer }, data: { token } })).json();
  const threadId: string = query.threads.find((thread: { comments: Array<{ body: string }> }) => thread.comments[0].body === body).id;

  // The person mentioned signs in: one unread entry, labelled as a mention, leading to the shared page.
  const unread = async () => (await (await request.get(`${mentioned}/api/review-notifications/unread`, { headers: { Origin: mentioned } })).json())
    .notifications.filter((notice: { threadId: string }) => notice.threadId === threadId);
  expect(await unread()).toEqual([expect.objectContaining({ kind: "MENTION", id: expect.stringMatching(/^mention:/), excerpt: body, authorName: "Phase3 viewer", linkAvailable: true })]);
  const workspaceId = await personalWorkspaceId(request, mentioned);
  await page.goto(`${mentioned}/w/${workspaceId}/inbox`);
  await expect(page.getByRole("link", { name: "Inbox, 1 unread", exact: true })).toBeVisible();
  const entry = page.getByRole("list", { name: "Inbox discussions" }).locator(`a[href="/s/${token}?thread=${threadId}"]`);
  await expect(entry).toContainText("Mentioned you");
  await expect(entry).toContainText(`Phase3 viewer: ${body}`);
  await entry.click();
  const selected = page.getByRole("region", { name: "Selected discussion" });
  await expect(selected.getByText(body, { exact: true })).toBeVisible();
  await selected.getByRole("link", { name: "Open document" }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${token}\\?thread=${threadId}`));
  const card = page.locator(`[data-review-thread="${threadId}"]`);
  await expect(card).toHaveAttribute("data-active", "");
  await expect(card.getByText(body, { exact: true })).toBeVisible();
  await expect.poll(unread).toEqual([]);
  await page.goto(`${mentioned}/w/${workspaceId}/inbox`);
  await expect(page.getByRole("link", { name: "Inbox", exact: true })).toBeVisible();

  // Being mentioned follows the discussion: the owner's reply arrives as a follow entry.
  await page.goto(doc.href);
  await openReviewDiscussions(page);
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Owner answer");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.getByText("Owner answer", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect.poll(unread).toEqual([expect.objectContaining({ kind: "FOLLOW", excerpt: "Owner answer", authorName: "Phase3 reviewOwner", linkAvailable: true })]);
  await page.goto(`${mentioned}/w/${workspaceId}/inbox`);
  await expect(page.getByRole("link", { name: "Inbox, 1 unread", exact: true })).toBeVisible();
  const followed = page.getByRole("list", { name: "Inbox discussions" }).locator(`a[href="/s/${token}?thread=${threadId}"]`).filter({ hasText: "Owner answer" });
  await expect(followed).toContainText("Discussion you follow");
  // Leave this person's Inbox as it was found for a repeated run.
  expect((await request.post(`${mentioned}/api/review-notifications/activity`, { headers: { Origin: mentioned }, data: { action: "mark-all-read" } })).ok()).toBe(true);
});

test("an owner with no live share link is told to create one before mentioning", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner"), viewer = phase3Origin("viewer");
  const token = doc.links[0].path.split("/").pop()!;
  const created = await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: { token, expectedRevisionId: doc.revisionId, anchor: ANCHOR, body: "A reader's question", idempotencyKey: crypto.randomUUID() } });
  expect(created.status()).toBe(201);
  for (const link of doc.links) expect((await request.post(`${owner}/api/share-links/${link.id}/revoke`)).ok()).toBe(true);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(doc.href);
  await openReviewDiscussions(page);
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  const composer = page.getByRole("textbox", { name: "Reply", exact: true });
  await composer.click();
  await composer.pressSequentially("Asking @Phase3");
  await expect(page.getByText("Create a share link first to mention someone", { exact: true })).toBeVisible();
  await expect(page.getByRole("listbox", { name: "People to mention" })).toHaveCount(0);
});

// Review of PR #306: a mention is read by arriving on its thread, whether or not the person still follows it.
test("a mentioned person who stopped following clears the mention by opening its thread", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const token = doc.links[0].path.split("/").pop()!;
  const viewer = phase3Origin("viewer"), mentioned = phase3Origin("groupAdmin");
  expect((await request.post(`${mentioned}/api/review-notifications/activity`, { headers: { Origin: mentioned }, data: { action: "mark-all-read" } })).ok()).toBe(true);
  const { candidates } = await (await request.get(`${viewer}/api/review-mentions/candidates?query=groupAdmin&token=${token}`, { headers: { Origin: viewer } })).json();
  const body = "Unfollowed but still @Phase3 groupAdmin";
  const created = await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: { token, expectedRevisionId: doc.revisionId, anchor: ANCHOR, body, idempotencyKey: crypto.randomUUID(), mentions: [candidates[0].id] } });
  expect(created.status()).toBe(201);
  const query = await (await request.post(`${viewer}/api/share-review/threads/query`, { headers: { Origin: viewer }, data: { token } })).json();
  const threadId: string = query.threads.find((thread: { comments: Array<{ body: string }> }) => thread.comments[0].body === body).id;
  expect((await request.post(`${mentioned}/api/review-follows/${threadId}/unfollow`, { headers: { Origin: mentioned } })).ok()).toBe(true);
  const unread = async () => (await (await request.get(`${mentioned}/api/review-notifications/unread`, { headers: { Origin: mentioned } })).json())
    .notifications.filter((notice: { threadId: string }) => notice.threadId === threadId);
  expect(await unread()).toEqual([expect.objectContaining({ kind: "MENTION" })]);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${mentioned}/s/${token}?thread=${threadId}`);
  await expect(page.locator(`[data-review-thread="${threadId}"]`)).toHaveAttribute("data-active", "");
  await expect.poll(unread).toEqual([]);
});

// Spec 2026-10-30: the people a visible comment mentions are shown to whoever holds the link, signed in or not.
test("an anonymous reader sees a mention highlighted and who it is", async ({ request, browser, baseURL }) => {
  const doc = await createReviewDocument(request);
  const token = doc.links[0].path.split("/").pop()!;
  const viewer = phase3Origin("viewer");
  const { candidates } = await (await request.get(`${viewer}/api/review-mentions/candidates?query=groupAdmin&token=${token}`, { headers: { Origin: viewer } })).json();
  const body = "Please look @Phase3 groupAdmin at this";
  const created = await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: { token, expectedRevisionId: doc.revisionId, anchor: ANCHOR, body, idempotencyKey: crypto.randomUUID(), mentions: [candidates[0].id] } });
  expect(created.status()).toBe(201);

  const anonymous = await browser.newContext({ baseURL: baseURL! });
  try {
    const visitor = await anonymous.newPage();
    await visitor.setViewportSize({ width: 1440, height: 900 });
    await visitor.goto(`/s/${token}`);
    await openReviewDiscussions(visitor);
    const mention = visitor.getByRole("button", { name: "Phase3 groupAdmin, mentioned" });
    await expect(mention).toHaveText("@Phase3 groupAdmin");
    const card = visitor.locator("[data-mention-card]");

    await mention.hover();
    await expect(card).toContainText("Phase3 groupAdmin");
    await expect(card).toContainText("P3-106");
    await visitor.mouse.move(0, 0);
    await expect(card).toHaveCount(0);

    await mention.click();
    await expect(card).toContainText("P3-106");
    await expect(mention).toHaveAttribute("aria-expanded", "true");
    await visitor.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
    await visitor.mouse.move(0, 0);

    // Resting on it opens the card; pressing it after the patient-click window must not close it.
    await mention.hover();
    await expect(card).toBeVisible();
    await visitor.waitForTimeout(800);
    await mention.click();
    await expect(card).toBeVisible();
    await expect(mention).toHaveAttribute("aria-expanded", "true");
    await visitor.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
    await visitor.mouse.move(0, 0);

    await visitor.keyboard.press("Tab");
    await mention.focus();
    await expect(card).toContainText("P3-106");
    await visitor.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
  } finally {
    await anonymous.close();
  }
});
