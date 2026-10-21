import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { phase3Origin, phase3NoSessionOrigin, phase3UnconfiguredOrigin, phase3UserId } from "./fixtures/phase3-identities";
import { createReviewDocument, openReviewDiscussions, selectPassage } from "./fixtures/document-review";

test("two trusted people use different links for the same discussion", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await page.goto(`${phase3Origin("viewer")}${doc.links[1].path}`);
  await openReviewDiscussions(page);
  await selectPassage(page);
  // Read-only article text does not support Shift+Arrow selection without caret browsing.
  // Keep the selected passage while activating the comment action with the keyboard.
  await page.getByRole("button", { name: "Comment on selection" }).focus();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("😀 bold");
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "Add comment" }).fill("Reviewer observation <script>unsafe</script>");
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await expect(page.locator("[data-review-thread]").getByText("Reviewer observation <script>unsafe</script>", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get("document-review")?.size ?? 0)).toBeGreaterThan(0);
  const highlight = await page.evaluate(() => { const registry = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights; const ranges = registry.get("document-review"); const range = ranges && Array.from(ranges)[0]; const rect = range?.getBoundingClientRect(); window.getSelection()?.removeAllRanges(); return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null; });
  expect(highlight).not.toBeNull();
  await page.mouse.click(highlight!.x, highlight!.y);
  await expect(page.locator("[data-review-thread]").filter({ visible: true })).toBeFocused();
  const response = await request.post(`${phase3Origin("reviewOwner")}/api/share-review/threads/query`, { headers: { Origin: phase3Origin("reviewOwner") }, data: { token: doc.links[0].path.split("/").pop(), emp_id: "forged" } });
  const result = await response.json();
  expect(result.callerUserId).toBe(phase3UserId("reviewOwner"));
  // The other link names who wrote the comment and hands over no user ID but the reader's own.
  expect(result.threads[0].comments[0].authorName).toBe("Phase3 viewer");
  expect(result.threads[0].comments[0]).not.toHaveProperty("authorUserId");
  expect(JSON.stringify(result.threads)).not.toContain(phase3UserId("viewer"));
  expect(result.threads).toHaveLength(1);
  await page.screenshot({ path: "/tmp/document-review-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await openReviewDiscussions(page);
  await expect(page.getByRole("dialog").getByRole("button", { name: "Refresh comments" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: "/tmp/document-review-mobile.png", fullPage: true });
});

test("anonymous readers see comments but cannot create or reply, even without an identity provider", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const token = doc.links[0].path.split("/").pop();
  const viewer = phase3Origin("viewer");
  const created = await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: { token, expectedRevisionId: doc.revisionId, anchor: { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 2, endUtf16: 9, exact: "😀 bold", prefix: "A ", suffix: " passage to review." }, body: "Visible without signing in", idempotencyKey: crypto.randomUUID() } });
  expect(created.status()).toBe(201); const thread = await created.json();
  for (const [origin, status, code] of [[phase3NoSessionOrigin(), 401, "AUTH_REQUIRED"], [phase3UnconfiguredOrigin(), 503, "AUTH_UNAVAILABLE"]] as const) {
    const response = await request.post(`${origin}/api/share-review/threads/query`, { headers: { Origin: origin }, data: { token, emp_id: "forged" } });
    expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toContain("no-store");
    const result = await response.json(); expect(result).toMatchObject({ callerUserId: null, writesEnabled: false }); expect(result.threads[0].comments[0].body).toBe("Visible without signing in");
    for (const path of ["/api/share-review/threads", `/api/share-review/threads/${thread.id}/replies`]) {
      const denied = await request.post(`${origin}${path}`, { headers: { Origin: origin }, data: { token, body: "Anonymous write", emp_id: "forged" } });
      expect(denied.status()).toBe(status); expect(JSON.stringify(await denied.json())).toContain(code);
    }
    await page.goto(`${origin}${doc.links[0].path}`);
    await openReviewDiscussions(page);
    await expect(page.locator("[data-review-document]")).toContainText("bold");
    await expect(page.locator("[data-review-thread]")).toContainText("Visible without signing in");
    await expect(page.getByText("Sign in to add a comment.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Comment on selection" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reply", exact: true })).toHaveCount(0);
  }
  const owner = phase3Origin("reviewOwner");
  expect((await request.post(`${owner}/api/share-links/${doc.links[0].id}/revoke`)).ok()).toBe(true);
  const revoked = await request.post(`${phase3NoSessionOrigin()}/api/share-review/threads/query`, { headers: { Origin: phase3NoSessionOrigin() }, data: { token } });
  expect(revoked.status()).toBe(404); expect(JSON.stringify(await revoked.json())).not.toContain("Visible without signing in");
});

test("anonymous readers find the discussions open beside the document and are offered sign-in to comment", async ({ page, request }) => {
  const doc = await createReviewDocument(request, "A first passage to review.\n\nA second paragraph here.");
  const token = doc.links[0].path.split("/").pop();
  const viewer = phase3Origin("viewer");
  const created = await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: { token, expectedRevisionId: doc.revisionId, anchor: { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 2, endUtf16: 7, exact: "first", prefix: "A ", suffix: " passage to review." }, body: "Open without a click", idempotencyKey: crypto.randomUUID() } });
  expect(created.status()).toBe(201);
  const origin = phase3NoSessionOrigin();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}${doc.links[0].path}`);
  const entry = page.getByRole("button", { name: /^(Open|Hide) discussions/ });
  await expect(entry).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("[data-review-thread]")).toContainText("Open without a click");
  const signIn = page.getByRole("link", { name: "Sign in to comment" });
  await expect(signIn).toHaveAttribute("href", new RegExp(`/\\?returnTo=${encodeURIComponent(`/s/${token}`)}$`));
  // Choosing a passage offers sign-in where a signed-in reader is offered Comment.
  await selectPassage(page, "first");
  await expect(page.locator(".kh-selection-bubble").getByRole("link", { name: "Sign in to comment" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Comment on selection" })).toHaveCount(0);
  // Closed once, it stays closed: it opens with the page, not again.
  await entry.click();
  await expect(entry).toHaveAttribute("aria-expanded", "false");
});

test("signing in to comment comes back to the shared page, where the reader can comment", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const token = doc.links[0].path.split("/").pop()!;
  const viewer = phase3Origin("viewer");
  // What the sign-in link continues to once the reader is signed in.
  await page.goto(`${viewer}/?returnTo=${encodeURIComponent(`/s/${token}`)}`);
  await expect(page).toHaveURL(`${viewer}/s/${token}`);
  await expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-ready", "");
  await expect(page.getByRole("link", { name: "Sign in to comment" })).toHaveCount(0);
  await selectPassage(page);
  await expect(page.getByRole("button", { name: "Comment on selection" })).toBeVisible();
});

function postThread(request: APIRequestContext, doc: Awaited<ReturnType<typeof createReviewDocument>>, block: number, exact: string, prefix: string, suffix: string, body: string) {
  const token = doc.links[0].path.split("/").pop();
  const viewer = phase3Origin("viewer");
  return request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: { token, expectedRevisionId: doc.revisionId, anchor: { schemaVersion: 1, blockPath: [block], blockKind: "paragraph", startUtf16: prefix.length, endUtf16: prefix.length + exact.length, exact, prefix, suffix }, body, idempotencyKey: crypto.randomUUID() } });
}

test("a reader who closes the discussions finds them closed next time, until a new one arrives", async ({ page, request }) => {
  const doc = await createReviewDocument(request, "A first passage to review.\n\nA second paragraph here.");
  expect((await postThread(request, doc, 0, "first", "A ", " passage to review.", "One")).status()).toBe(201);
  await page.setViewportSize({ width: 1440, height: 900 });
  const url = `${phase3NoSessionOrigin()}${doc.links[0].path}`;
  await page.goto(url);
  const entry = page.getByRole("button", { name: /^(Open|Hide) discussions/ });
  await expect(entry).toHaveAttribute("aria-expanded", "true");
  await entry.click();
  await page.reload();
  await expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-ready", "");
  await expect(entry).toHaveAttribute("aria-expanded", "false");
  expect((await postThread(request, doc, 1, "second", "A ", " paragraph here.", "Two")).status()).toBe(201);
  await page.reload();
  await expect(entry).toHaveAttribute("aria-expanded", "true");
});

test("coming back to the tab offers new comments without moving the cards", async ({ page, request }) => {
  const doc = await createReviewDocument(request, "A first passage to review.\n\nA second paragraph here.");
  expect((await postThread(request, doc, 0, "first", "A ", " passage to review.", "One")).status()).toBe(201);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${phase3NoSessionOrigin()}${doc.links[0].path}`);
  const cards = page.locator("[data-review-rail] [data-review-thread]").filter({ visible: true });
  await expect(cards).toHaveCount(1);
  expect((await postThread(request, doc, 1, "second", "A ", " paragraph here.", "Arrived while away")).status()).toBe(201);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  const notice = page.getByRole("button", { name: "1 new comment", exact: true });
  await expect(notice).toBeVisible();
  await expect(cards).toHaveCount(1);
  await notice.click();
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: "Arrived while away" })).toHaveCount(1);
  await expect(notice).toHaveCount(0);
});

test("the panel says how to comment before Add comment is pressed", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await openReviewDiscussions(page);
  const hint = page.getByText("Select text in the document to comment on it.", { exact: true }).filter({ visible: true });
  await expect(hint).toBeVisible();
  await selectPassage(page);
  await expect(hint).toHaveCount(0);
});

test("an unsent comment and an unsent reply survive a reload; sending forgets them", async ({ page, request }) => {
  const doc = await createReviewDocument(request, "A first passage to review.\n\nA second paragraph here.");
  expect((await postThread(request, doc, 1, "second", "A ", " paragraph here.", "Existing")).status()).toBe(201);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await openReviewDiscussions(page);
  await selectPassage(page, "first");
  await page.getByRole("button", { name: "Comment on selection" }).click();
  await page.getByRole("textbox", { name: "Add comment" }).fill("Kept across a reload");
  const card = page.locator("[data-review-rail] [data-review-thread]").filter({ visible: true }).filter({ hasText: "Existing" });
  await card.click();
  await card.getByRole("button", { name: "Reply", exact: true }).click();
  await card.getByRole("textbox", { name: "Reply", exact: true }).fill("Reply in progress");

  await page.reload();
  await expect(page.getByText("Restored your unsent comment. Check the quoted passage before sending.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Add comment" })).toHaveValue("Kept across a reload");
  await expect(card).toContainText("Unsent reply");
  await card.click();
  await expect(card.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("Reply in progress");

  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await expect(page.locator("[data-review-thread]").filter({ visible: true }).filter({ hasText: "Kept across a reload" })).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-ready", "");
  await expect(page.getByRole("textbox", { name: "Add comment" })).toHaveCount(0);
});

test("a shared page with no discussions keeps them closed", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${phase3NoSessionOrigin()}${doc.links[0].path}`);
  await expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-ready", "");
  await expect(page.getByRole("button", { name: /^Open discussions/ })).toHaveAttribute("aria-expanded", "false");
});

test("review rejects cross-origin and browser-supplied identities", async ({ request }) => {
  const doc = await createReviewDocument(request);
  const origin = phase3Origin("viewer");
  const data = { token: doc.links[0].path.split("/").pop(), emp_id: "forged", userId: phase3UserId("reviewOwner") };
  const denied = await request.post(`${origin}/api/share-review/threads/query`, { headers: { Origin: phase3Origin("reviewOwner") }, data });
  expect(denied.status()).toBe(403);
  const accepted = await request.post(`${origin}/api/share-review/threads/query`, { headers: { Origin: origin, "x-user-id": phase3UserId("reviewOwner"), "x-employee-id": "forged" }, data });
  expect((await accepted.json()).callerUserId).toBe(phase3UserId("viewer"));
  const navigation = await (await request.get(`${origin}/api/workspaces`)).json();
  expect(navigation.items.map((item: { id: string }) => item.id)).not.toContain(doc.workspaceId);
});
