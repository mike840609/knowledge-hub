import { expect, test, type Page } from "./fixtures/test";
import { mySpace, ROUND_TRIP, unique } from "./fixtures/organize";
import { createReviewDocument, openReviewDiscussions, selectPassage } from "./fixtures/document-review";
import { phase3Origin, phase3UnconfiguredOrigin } from "./fixtures/phase3-identities";

test.describe("source share link", () => {
  test.skip(!process.env.KM_PHASE3_APP_ROOT && process.env.KM_E2E_UNCONFIGURED_SERVER !== "true", "Run npm run test:e2e to provision the no-sign-in origin.");

  async function unavailable(page: Page, url: string) {
    await page.goto(url);
    await expect(page.getByText("This link is not available", { exact: true })).toBeVisible(ROUND_TRIP);
    await expect(page.getByRole("navigation")).toHaveCount(0);
    return (await page.locator("main").innerText()).trim();
  }

  test("owner shares a live source and readers navigate, comment and save", async ({ page, browser, context }) => {
    test.setTimeout(180_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const workspace = await mySpace(page);
    const name = unique("Shared source"), renamed = `${name} renamed`;
    const intro = unique("Intro"), deep = unique("Deep"), outside = unique("Outside"), sub = unique("Sub");
    const outsideResponse = await page.request.post(`/api/workspaces/${workspace}/documents`, { data: { title: outside, markdown: "Outside the source" } });
    expect(outsideResponse.status()).toBe(201);
    const outsideId = ((await outsideResponse.json()) as { documentId: string }).documentId;
    const files = [
      { path: `${intro}.md`, body: `# ${intro}\n\nIntro body text.` },
      { path: `${sub}/${deep}.md`, body: `# ${deep}\n\nDeep body text with [[${intro}]] and [[${outside}]].` },
    ];
    const manifest = files.map((file, i) => ({ uploadKey: `m${i}`, relativePath: file.path, kind: "MARKDOWN", size: Buffer.byteLength(file.body) }));
    const staged = await page.request.post(`/api/workspaces/${workspace}/source-imports`, { data: { sourceName: name, rootName: "wiki", manifest } });
    expect(staged.ok()).toBe(true);
    const { snapshotId } = await staged.json() as { snapshotId: string };
    const multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = { entries: JSON.stringify(files.map((_, i) => ({ uploadKey: `m${i}`, field: `f${i}` }))) };
    files.forEach((file, i) => { multipart[`f${i}`] = { name: file.path.split("/").pop()!, mimeType: "text/markdown", buffer: Buffer.from(file.body) }; });
    expect((await page.request.post(`/api/source-imports/${snapshotId}/entries`, { multipart })).ok()).toBe(true);
    expect((await page.request.post(`/api/source-imports/${snapshotId}/finalize`, { data: {} })).ok()).toBe(true);
    const applied = await page.request.post(`/api/source-imports/${snapshotId}/apply`, { data: {} });
    expect(applied.ok()).toBe(true);
    const { sourceId } = await applied.json() as { sourceId: string };
    await page.goto(`/w/${workspace}/sources`);
    const sourceRow = page.locator("li").filter({ has: page.locator(`a[data-list-row][href="/w/${workspace}/sources/${sourceId}"]`) });
    await sourceRow.getByRole("button", { name: `Share source ${name}` }).click();
    const dialog = page.getByRole("dialog", { name: `Share source ${name}` });
    await dialog.getByLabel(/Label/).fill("for readers");
    await dialog.getByRole("button", { name: "Create link" }).click();
    const item = dialog.locator("[data-share-link]").first();
    await expect(item).toContainText("for readers", ROUND_TRIP);
    const path = (await item.getAttribute("data-share-link"))!;
    await item.getByRole("button", { name: "Copy link" }).click();
    await expect(item.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(page.url()).origin}${path}`);
    await page.keyboard.press("Escape");
    await expect(sourceRow.getByRole("img", { name: "Shared" })).toBeVisible(ROUND_TRIP);
    await page.goto(`/w/${workspace}/knowledge/${sourceId}`);
    const explorer = page.getByRole("complementary", { name: "Knowledge explorer" });
    await expect(explorer.getByRole("img", { name: "Shared" })).toBeVisible(ROUND_TRIP);
    await explorer.getByRole("button", { name: `Share source ${name}` }).click();
    const sidebarDialog = page.getByRole("dialog", { name: `Share source ${name}` });
    await expect(sidebarDialog.locator("[data-share-link]")).toContainText("for readers", ROUND_TRIP);
    // The sidebar is an entry point of its own: make a link here, then revoke it so the
    // Sources-page link stays the only one this source has.
    await sidebarDialog.getByLabel(/Label/).fill("from sidebar");
    await sidebarDialog.getByRole("button", { name: "Create link" }).click();
    const fromSidebar = sidebarDialog.locator("[data-share-link]").filter({ hasText: "from sidebar" });
    await expect(fromSidebar).toBeVisible(ROUND_TRIP);
    await fromSidebar.getByRole("button", { name: "Revoke", exact: true }).click();
    await fromSidebar.getByRole("button", { name: "Confirm revoke" }).click();
    await expect(sidebarDialog.locator("[data-share-link]").filter({ hasText: "from sidebar" })).toHaveCount(0, ROUND_TRIP);
    await page.keyboard.press("Escape");

    const base = phase3UnconfiguredOrigin();
    const anonymous = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const reader = await anonymous.newPage();
    let deepId: string;
    try {
      await reader.goto(`${base}${path}`);
      const tree = reader.getByRole("navigation", { name });
      await expect(tree).toBeVisible(ROUND_TRIP);
      await expect(reader.getByRole("heading", { level: 1 })).toHaveText(deep);
      const folder = tree.getByRole("button", { name: sub, exact: true });
      if (await folder.getAttribute("aria-expanded") === "false") await folder.click();
      await tree.getByRole("link", { name: deep, exact: true }).click();
      await expect(reader).toHaveURL(/\?d=/);
      deepId = new URL(reader.url()).searchParams.get("d")!;
      expect(deepId).toMatch(/^[0-9a-f-]{36}$/);
      await expect(reader.getByRole("heading", { level: 1 })).toHaveText(deep);
      const article = reader.locator("article").first();
      await expect(article.getByText(outside, { exact: true })).toBeVisible();
      await expect(article.locator("span", { hasText: new RegExp(`^${outside}$`) })).not.toHaveAttribute("title", /.*/);
      await expect(article.getByRole("link", { name: outside })).toHaveCount(0);
      await article.getByRole("link", { name: intro, exact: true }).click();
      await expect(reader.getByRole("heading", { level: 1 })).toHaveText(intro);
      await expect(reader).toHaveURL(/\?d=/);
      const introId = new URL(reader.url()).searchParams.get("d")!;
      const unknown = await unavailable(reader, `${base}/s/${crypto.randomUUID()}`);
      const foreign = await createReviewDocument(page.request);
      for (const id of [outsideId, foreign.documentId, "junk"]) expect(await unavailable(reader, `${base}${path}?d=${id}`)).toBe(unknown);
      await reader.setViewportSize({ width: 390, height: 844 });
      await reader.goto(`${base}${path}?d=${introId}`);
      const disclosure = reader.getByRole("button", { name: "Source contents" });
      await expect(disclosure).toBeVisible(ROUND_TRIP);
      await expect(tree).toBeHidden();
      await disclosure.click();
      await expect(tree).toBeVisible();
      if (await folder.getAttribute("aria-expanded") === "false") await folder.click();
      await tree.getByRole("link", { name: deep, exact: true }).click();
      await expect(reader).toHaveURL(`${base}${path}?d=${deepId}`);
      await expect(tree).toBeHidden();
    } finally { await anonymous.close(); }

    const signedIn = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    try {
      const commenter = await signedIn.newPage();
      await commenter.goto(`${phase3Origin("viewer")}${path}?d=${deepId}`);
      await openReviewDiscussions(commenter);
      await selectPassage(commenter, "body text");
      await commenter.getByRole("button", { name: "Comment on selection" }).focus({ timeout: 5000 });
      await commenter.keyboard.press("Enter");
      await commenter.getByRole("textbox", { name: "Add comment" }).fill("Source reader question");
      await commenter.getByRole("button", { name: "Add comment", exact: true }).click();
      await expect(commenter.locator("[data-review-thread]").getByText("Source reader question", { exact: true })).toBeVisible(ROUND_TRIP);
      await commenter.getByRole("button", { name: "Save share", exact: true }).click();
      await commenter.getByRole("link", { name: "View saved shares", exact: true }).click();
      const saved = commenter.getByRole("list", { name: "Saved shares" }).getByRole("link", { name: `Source ${name}`, exact: true });
      await expect(saved).toBeVisible(ROUND_TRIP);
      await expect(saved.locator("svg.lucide-database")).toHaveCount(1);
    } finally { await signedIn.close(); }
    await page.goto(`/w/${workspace}/inbox`);
    await expect(page.getByRole("list", { name: "Inbox discussions" }).getByText("Source reader question")).toBeVisible(ROUND_TRIP);
    await page.goto(`/w/${workspace}/shares`);
    const shares = page.getByRole("list", { name: "Share links" });
    const shareRow = shares.getByRole("listitem").filter({ has: page.getByRole("link", { name: `Source ${name}`, exact: true }) });
    await expect(shareRow.getByRole("link", { name: /unread comments for/ })).toContainText("1 new", ROUND_TRIP);
    await page.goto(`/w/${workspace}/knowledge/${sourceId}/${deepId}`);
    await page.locator("main").getByRole("button", { name: "Share link…" }).click();
    await expect(page.getByRole("list", { name: "Also shared through sources" })).toContainText("Also visible through the shared source", ROUND_TRIP);
    await page.keyboard.press("Escape");
    await page.goto(`/w/${workspace}/sources`);
    const actions = (n: string) => sourceRow.getByRole("button", { name: `Source actions: ${n}`, exact: true });
    await actions(name).click();
    await page.getByRole("menuitem", { name: "Rename source" }).click();
    const rename = page.getByRole("dialog", { name: "Rename source" });
    await rename.getByLabel("Name").fill(renamed);
    await rename.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(sourceRow).toContainText(renamed, ROUND_TRIP);
    const after = await browser.newContext();
    try {
      const check = await after.newPage();
      await check.goto(`${base}${path}`);
      await expect(check.getByRole("heading", { level: 1 })).toHaveText(deep, ROUND_TRIP);
      await actions(renamed).click();
      await page.getByRole("menuitem", { name: "Archive source" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Archive source" }).click();
      await expect(sourceRow).toHaveCount(0, ROUND_TRIP);
      await unavailable(check, `${base}${path}`);
      await unavailable(check, `${base}${path}?d=${deepId}`);
      await page.getByRole("checkbox", { name: "Show archived" }).check();
      await actions(renamed).click();
      await page.getByRole("menuitem", { name: "Restore source" }).click();
      await expect(sourceRow).not.toContainText("Archived", ROUND_TRIP);
      await check.goto(`${base}${path}`);
      await expect(check.getByRole("heading", { level: 1 })).toHaveText(deep, ROUND_TRIP);
      await page.goto(`/w/${workspace}/shares`);
      const target = shares.getByRole("listitem").filter({ has: page.getByRole("link", { name: `Source ${renamed}`, exact: true }) });
      await target.getByRole("button", { name: `Share actions for source ${renamed} · for readers`, exact: true }).click();
      await page.getByRole("menuitem", { name: "Revoke", exact: true }).click();
      await page.getByRole("alertdialog", { name: "Revoke share link?" }).getByRole("button", { name: "Confirm revoke" }).click();
      await expect(target).toHaveCount(0, ROUND_TRIP);
      await unavailable(check, `${base}${path}`);
      await unavailable(check, `${base}${path}?d=${deepId}`);
    } finally { await after.close(); }
  });
});
