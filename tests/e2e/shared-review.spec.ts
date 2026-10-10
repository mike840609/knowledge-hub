import { expect, test } from "./fixtures/test";
import { phase3Origin, phase3NoSessionOrigin, phase3UnconfiguredOrigin, phase3UserId } from "./fixtures/phase3-identities";
import { createReviewDocument, selectPassage } from "./fixtures/document-review";

test("two trusted people use different links for the same discussion", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await page.goto(`${phase3Origin("viewer")}${doc.links[1].path}`);
  await selectPassage(page);
  await page.locator("[data-review-document] p").first().evaluate(element => { (element as HTMLElement).tabIndex = -1; (element as HTMLElement).focus(); window.getSelection()!.collapseToStart(); });
  for (let index = 0; index < 6; index++) await page.keyboard.press("Shift+ArrowRight");
  // Focus via keyboard without discarding the browser text selection.
  await page.getByRole("button", { name: "Comment on selection" }).focus();
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
  await page.getByRole("button", { name: "Open discussions" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Refresh discussions" })).toBeVisible();
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
