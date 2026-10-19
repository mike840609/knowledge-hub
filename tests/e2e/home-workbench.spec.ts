import { test, expect } from "./fixtures/test";

test("home workbench keeps discussion placement stable and reflows responsively", async ({ page, request }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const navigation = await (await request.get("/api/workspaces")).json();
  const workspaceId = navigation.items.find((item: { type: string }) => item.type === "PERSONAL").id;
  const title = `Home work ${crypto.randomUUID().slice(0, 8)}`;
  const created = await request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown: "Continue this note." } });
  expect(created.ok()).toBe(true);
  const doc = await created.json();
  for (const extraTitle of ["Quarterly planning notes", "Customer feedback and follow-up", "Design review decisions", "跨部門產品需求與驗收規格：第三季度功能調整及後續追蹤事項", "Customer onboarding checklist"]) {
    const extra = await request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title: extraTitle, markdown: "Continue this note." } });
    expect(extra.ok()).toBe(true);
  }
  const importedTitles = ["跨部門產品需求與驗收規格：第三季度功能調整及後續追蹤事項", "客服回饋與問題分析整理", "新版產品上線準備清單"];
  const files = importedTitles.map((heading, i) => ({ name: `note-${i}.md`, buffer: Buffer.from(`# ${heading}\n\nReview this update.`) }));
  const staged = await request.post(`/api/workspaces/${workspaceId}/source-imports`, { data: {
    sourceName: "產品研發與客戶服務跨部門共享知識庫", rootName: "Home layout",
    manifest: files.map((file, i) => ({ uploadKey: `m${i}`, relativePath: file.name, kind: "MARKDOWN", size: file.buffer.length })),
  } });
  expect(staged.ok()).toBe(true);
  const { snapshotId } = await staged.json();
  const multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = {
    entries: JSON.stringify(files.map((_, i) => ({ uploadKey: `m${i}`, field: `f${i}` }))),
  };
  files.forEach((file, i) => { multipart[`f${i}`] = { ...file, mimeType: "text/markdown" }; });
  expect((await request.post(`/api/source-imports/${snapshotId}/entries`, { multipart })).ok()).toBe(true);
  expect((await request.post(`/api/source-imports/${snapshotId}/finalize`, { data: {} })).ok()).toBe(true);
  expect((await request.post(`/api/source-imports/${snapshotId}/apply`, { data: {} })).ok()).toBe(true);
  const draftEnvelope = await (await request.get(`/api/workspaces/${workspaceId}/personal?key=draft:new`)).json();
  expect((await request.put(`/api/workspaces/${workspaceId}/personal`, { data: {
    key: "draft:new", version: draftEnvelope.version,
    value: { title: "Unfinished planning draft", markdown: "Resume writing here.", baseRevisionId: null },
  } })).ok()).toBe(true);
  let releaseInitialFetch!: () => void;
  let initialFetchReleased = false;
  const initialFetch = new Promise<void>(resolve => { releaseInitialFetch = resolve; });
  let hasUnread = false;
  await page.route("**/api/review-notifications/unread", async route => {
    if (!initialFetchReleased) await initialFetch;
    await route.fulfill({ json: { notifications: hasUnread ? [{
      id: "home-layout-notice",
      workspaceId,
      sourceId: doc.sourceId,
      documentId: doc.documentId,
      threadId: "home-layout-thread",
      documentTitle: title,
      authorName: "Alex",
      excerpt: "Please review this note",
      createdAt: "2026-10-17T00:00:00.000Z",
      readAt: null,
      threadStatus: "OPEN",
    }] : [] } });
  });
  await page.addInitScript(() => Object.defineProperty(navigator, "platform", { get: () => localStorage.getItem("home-test-platform") ?? "Win32", configurable: true }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/w/${workspaceId}/home`);
  const work = page.getByRole("region", { name: "Continue working", exact: true });
  const attention = page.getByRole("region", { name: "Discussions", exact: true });
  const favorites = page.getByRole("region", { name: "Favorites", exact: true });
  const updates = page.getByRole("region", { name: "Knowledge updates", exact: true });
  const row = work.locator(`[data-list-row][href="/w/${workspaceId}/knowledge/${doc.sourceId}/${doc.documentId}"]`);
  await expect(row).toBeVisible();
  await expect(row).toHaveCount(1);
  await expect(work.locator("[data-list-row]")).toHaveCount(6);
  const updateList = updates.getByRole("list", { name: "Unread knowledge updates" });
  await expect(updateList.getByRole("listitem")).toHaveCount(3);
  for (const importedTitle of importedTitles) await expect(updateList.getByText(importedTitle, { exact: true })).toBeVisible();
  const updateTitle = updateList.locator("a > span").first();
  const updateMetadata = updateList.locator("a > span").nth(1);
  const titleBox = await updateTitle.boundingBox();
  const metadataBox = await updateMetadata.boundingBox();
  expect(metadataBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height);
  expect(titleBox!.width).toBeCloseTo(metadataBox!.width, 0);
  await expect(updateTitle).toHaveCSS("-webkit-line-clamp", "2");
  const searchButton = page.getByRole("button", { name: "Search articles and notes", exact: true });
  await expect(searchButton).toContainText("Ctrl K");
  await updates.getByRole("link", { name: "View all knowledge updates" }).focus();
  await page.keyboard.press("Tab");
  await expect(updateList.getByRole("link").first()).toBeFocused();
  await expect(page.getByRole("tooltip")).toContainText("產品研發與客戶服務跨部門共享知識庫");
  await expect(page.getByRole("tooltip")).toContainText(await updateTitle.innerText());
  await page.screenshot({ path: testInfo.outputPath("home-keyboard-tooltip.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await searchButton.focus();
  await expect(updates.getByRole("link", { name: "View all knowledge updates" })).toHaveAttribute("href", `/w/${workspaceId}/updates`);
  await expect(attention).toContainText("Loading discussions");
  const loadingWork = await work.boundingBox();
  const loadingAttention = await attention.boundingBox();
  expect(loadingWork).not.toBeNull();
  expect(loadingAttention).not.toBeNull();
  expect(loadingAttention!.x).toBeGreaterThan(loadingWork!.x + loadingWork!.width);
  initialFetchReleased = true;
  releaseInitialFetch();
  await expect(attention).toContainText("No new comments or replies");
  const desktopWork = await work.boundingBox();
  const desktopAttention = await attention.boundingBox();
  const desktopFavorites = await favorites.boundingBox();
  const desktopUpdates = await updates.boundingBox();
  expect(desktopWork).not.toBeNull();
  expect(desktopAttention).not.toBeNull();
  expect(desktopFavorites).not.toBeNull();
  expect(desktopUpdates).not.toBeNull();
  expect(desktopAttention!.x).toBeGreaterThan(desktopWork!.x + desktopWork!.width);
  expect(Math.abs(desktopAttention!.x - loadingAttention!.x)).toBeLessThan(1);
  expect(Math.abs(desktopAttention!.y - loadingAttention!.y)).toBeLessThan(1);
  expect(desktopFavorites!.x).toBeCloseTo(desktopWork!.x, 0);
  expect(desktopUpdates!.x).toBeCloseTo(desktopAttention!.x, 0);
  expect(desktopUpdates!.y - (desktopAttention!.y + desktopAttention!.height)).toBeCloseTo(32, 0);
  expect(desktopFavorites!.y - (desktopWork!.y + desktopWork!.height)).toBeCloseTo(32, 0);
  expect(desktopUpdates!.y).toBeLessThan(desktopFavorites!.y);
  const inbox = attention.getByRole("link", { name: "Open Inbox", exact: true });
  await expect(inbox).toBeVisible();
  const emptyInbox = await inbox.boundingBox();
  const saved = page.waitForResponse(response => response.url().endsWith("/personal") && response.request().method() === "PUT");
  await work.getByRole("button", { name: `Favorite: ${title}`, exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await expect(favorites.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  await expect(favorites).not.toContainText("Updated");
  await expect(work.getByRole("tab", { name: "Recent", exact: true })).toHaveAttribute("aria-selected", "true");
  const recentTab = work.getByRole("tab", { name: "Recent", exact: true });
  const draftsTab = work.getByRole("tab", { name: "Drafts · 1", exact: true });
  const selectedBorder = await recentTab.evaluate(element => getComputedStyle(element).borderBottomColor);
  expect(selectedBorder).not.toBe("rgba(0, 0, 0, 0)");
  await expect(draftsTab).toHaveCSS("border-bottom-color", "rgba(0, 0, 0, 0)");
  await expect(work.getByRole("link", { name: /Unfinished planning draft/ })).toHaveCount(0);
  const attentionBeforeTab = await attention.boundingBox();
  await work.getByRole("tab", { name: "Drafts · 1", exact: true }).click();
  await expect(draftsTab).toHaveCSS("border-bottom-color", selectedBorder);
  await expect(recentTab).toHaveCSS("border-bottom-color", "rgba(0, 0, 0, 0)");
  await expect(work.getByRole("tabpanel")).toContainText("Unfinished planning draft");
  await expect(work.getByRole("link", { name: /Unfinished planning draft/ })).toHaveAttribute("href", `/w/${workspaceId}/knowledge/new`);
  await expect(work.locator("[data-list-row]")).toHaveCount(1);
  await expect(favorites.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  const attentionAfterTab = await attention.boundingBox();
  expect(attentionAfterTab!.y).toBeCloseTo(attentionBeforeTab!.y, 0);
  await page.screenshot({ path: testInfo.outputPath("home-drafts.png"), fullPage: true });
  await work.getByRole("tab", { name: "Drafts · 1", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(work.getByRole("tab", { name: "Recent", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(work.locator("[data-list-row]")).toHaveCount(6);
  await page.getByRole("button", { name: "Search articles and notes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await searchButton.evaluate(element => element.blur());
  await page.mouse.move(0, 0);
  await page.screenshot({ path: testInfo.outputPath("home-desktop.png"), fullPage: true });
  await searchButton.screenshot({ path: testInfo.outputPath("home-search-normal.png") });
  await searchButton.hover();
  await searchButton.screenshot({ path: testInfo.outputPath("home-search-hover.png") });
  await page.mouse.move(0, 0);
  const favoritesBeforeUnread = await favorites.boundingBox();
  hasUnread = true;
  await page.evaluate(() => window.dispatchEvent(new Event("kh:notification-changed")));
  await expect(attention).toContainText("Please review this note");
  const unreadAttention = await attention.boundingBox();
  expect(unreadAttention).not.toBeNull();
  expect(Math.abs(unreadAttention!.x - desktopAttention!.x)).toBeLessThan(1);
  const favoritesAfterUnread = await favorites.boundingBox();
  expect(favoritesAfterUnread!.y).toBeCloseTo(favoritesBeforeUnread!.y, 0);
  const unreadInbox = await inbox.boundingBox();
  expect(unreadInbox!.y).toBeCloseTo(emptyInbox!.y, 0);
  await page.screenshot({ path: testInfo.outputPath("home-desktop-unread.png"), fullPage: true });
  await page.setViewportSize({ width: 1024, height: 900 });
  const intermediateOrder = [work, favorites, attention, updates];
  const intermediateBoxes = await Promise.all(intermediateOrder.map(region => region.boundingBox()));
  for (let i = 1; i < intermediateBoxes.length; i++) expect(intermediateBoxes[i]!.y).toBeGreaterThanOrEqual(intermediateBoxes[i - 1]!.y + intermediateBoxes[i - 1]!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileOrder = [work, favorites, attention, updates];
  const boxes = await Promise.all(mobileOrder.map(region => region.boundingBox()));
  for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.y).toBeGreaterThanOrEqual(boxes[i - 1]!.y + boxes[i - 1]!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("home-mobile.png"), fullPage: true });
  await page.evaluate(() => localStorage.setItem("home-test-platform", "MacIntel"));
  await page.reload();
  await expect(searchButton).toContainText("⌘K");
  await expect(favorites.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  expect(errors).toEqual([]);
});
