import { expect, test, type Page } from "./fixtures/test";
import { openPalette } from "./fixtures/palette";
import { personalWorkspaceId } from "./fixtures/my-space";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { parseGenericMarkdownText } from "../../src/modules/sources/adapters/generic-markdown-folder-adapter";

async function note(page: Page) {
  const workspace = await personalWorkspaceId(page);
  const response = await page.request.post(`/api/workspaces/${workspace}/documents`, { data: { title: `Inline ${Date.now()}`, markdown: "Original paragraph." } });
  expect(response.ok()).toBe(true);
  const result = await response.json();
  return { url: `/w/${workspace}/knowledge/${result.sourceId}/${result.documentId}`, id: result.documentId as string };
}
async function surface(page: Page, url: string) {
  await page.goto(url);
  const editor = page.getByRole("textbox", { name: "Content", exact: true });
  await expect(editor).toBeEditable({ timeout: 15000 });
  return editor;
}
const saved = (page: Page) => expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", { timeout: 15000 });

test("rename selects an opening heading and preserves the document body", async ({ page }) => {
  const workspace = await personalWorkspaceId(page);
  const response = await page.request.post(`/api/workspaces/${workspace}/documents`, { data: { title: "Old heading", markdown: "# Old heading\n\nKeep this paragraph." } });
  const result = await response.json();
  const url = `/w/${workspace}/knowledge/${result.sourceId}/${result.documentId}`;
  const editor = await surface(page, url);
  await page.getByRole("button", { name: "Rename document" }).click();
  await expect(editor).toBeFocused();
  await page.keyboard.insertText("New heading");
  await saved(page);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toContainText("New heading");
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toContainText("Keep this paragraph.");
});

test("rename also selects the heading in Markdown mode", async ({ page }) => {
  const workspace = await personalWorkspaceId(page);
  const response = await page.request.post(`/api/workspaces/${workspace}/documents`, { data: { title: "Old heading", markdown: "# Old heading\n\nKeep this paragraph." } });
  const result = await response.json();
  const url = `/w/${workspace}/knowledge/${result.sourceId}/${result.documentId}`;
  await surface(page, url);
  await page.getByRole("button", { name: "Markdown" }).click();
  await page.getByRole("button", { name: "Rename document" }).click();
  await page.keyboard.insertText("New heading");
  await saved(page);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toContainText("New heading");
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toContainText("Keep this paragraph.");
});

test("renaming a frontmatter title persists without changing other metadata or body", async ({ page }) => {
  const workspace = await personalWorkspaceId(page);
  const response = await page.request.post(`/api/workspaces/${workspace}/documents`, { data: { filename: "original.md", markdown: "---\ntitle: Original title\nowner: team\n---\n\nBody text." } });
  expect(response.status()).toBe(201);
  const result = await response.json();
  const url = `/w/${workspace}/knowledge/${result.sourceId}/${result.documentId}`;
  await surface(page, url);
  await page.getByRole("button", { name: "Rename document" }).click();
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await expect(title).toBeFocused();
  await title.fill("Updated title");
  await saved(page);
  const exported = await page.request.get(`/api/documents/${result.documentId}/export`);
  const markdown = await exported.text();
  expect(markdown).toContain("title: Updated title");
  expect(markdown).toContain("owner: team");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Updated title");
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toContainText("Body text.");
});

test("a conflicting frontmatter rename downloads the new title and original metadata", async ({ page }) => {
  const workspace = await personalWorkspaceId(page);
  const response = await page.request.post(`/api/workspaces/${workspace}/documents`, { data: { filename: "original.md", markdown: "---\ntitle: Original title\nowner: team\n---\n\n# Body heading\n\nBody text." } });
  expect(response.status()).toBe(201);
  const result = await response.json();
  await surface(page, `/w/${workspace}/knowledge/${result.sourceId}/${result.documentId}`);
  await page.route(`**/api/documents/${result.documentId}`, route => route.request().method() === "PATCH" ? route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "REVISION_CONFLICT", message: "Another writer saved this document." } }) }) : route.continue());
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Updated title");
  await expect(page.getByRole("button", { name: "Download my changes" })).toBeVisible({ timeout: 15000 });
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download my changes" }).click();
  const download = await pendingDownload;
  const downloaded = await readFile((await download.path())!, "utf8");
  expect(downloaded).toContain("title: Updated title");
  expect(downloaded).toContain("owner: team");
  expect(downloaded).toContain("Body heading");
  const parsed = parseGenericMarkdownText({ sourcePath: download.suggestedFilename(), text: downloaded, sourceFileHash: createHash("sha256").update(downloaded).digest("hex") });
  expect(parsed.markdown).toBe("\n# Body heading\n\nBody text.");
});

test("conflict recovery keeps an H1 as the title source", async ({ page }) => {
  const workspace = await personalWorkspaceId(page);
  const response = await page.request.post(`/api/workspaces/${workspace}/documents`, { data: { title: "Original heading", markdown: "# Original heading\n\nBody text." } });
  const result = await response.json();
  const editor = await surface(page, `/w/${workspace}/knowledge/${result.sourceId}/${result.documentId}`);
  await page.route(`**/api/documents/${result.documentId}`, route => route.request().method() === "PATCH" ? route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "REVISION_CONFLICT", message: "Another writer saved this document." } }) }) : route.continue());
  await editor.fill("# Changed heading\n\nBody text.");
  await expect(page.getByRole("button", { name: "Download my changes" })).toBeVisible({ timeout: 15000 });
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download my changes" }).click();
  const downloaded = await readFile((await (await pendingDownload).path())!, "utf8");
  expect(downloaded.trimStart()).not.toMatch(/^---/);
  const parsed = parseGenericMarkdownText({ sourcePath: (await pendingDownload).suggestedFilename(), text: downloaded, sourceFileHash: createHash("sha256").update(downloaded).digest("hex") });
  expect(parsed.resolvedTitle).toBe("# Changed heading");
  expect(parsed.titleSource).toBe("H1");
  expect(downloaded).toContain("Changed heading");
});

test("conflict recovery preserves non-string metadata titles", async ({ page }) => {
  const workspace = await personalWorkspaceId(page);
  const response = await page.request.post(`/api/workspaces/${workspace}/documents`, { data: { filename: "heading.md", markdown: "---\ntitle: 42\nowner: team\n---\n\n# Original heading\n\nBody text." } });
  expect(response.status()).toBe(201);
  const result = await response.json();
  const editor = await surface(page, `/w/${workspace}/knowledge/${result.sourceId}/${result.documentId}`);
  await page.route(`**/api/documents/${result.documentId}`, route => route.request().method() === "PATCH" ? route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "REVISION_CONFLICT", message: "Another writer saved this document." } }) }) : route.continue());
  await editor.fill("Changed content.");
  await expect(page.getByRole("button", { name: "Download my changes" })).toBeVisible({ timeout: 15000 });
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download my changes" }).click();
  const downloaded = await readFile((await (await pendingDownload).path())!, "utf8");
  expect(downloaded).toContain("title: 42");
  expect(downloaded).toContain("owner: team");
});

test("a recovered independently titled document retains its exact title and metadata when uploaded", async ({ page }) => {
  const workspace = await personalWorkspaceId(page);
  const response = await page.request.post(`/api/workspaces/${workspace}/documents`, { data: { filename: "original.md", markdown: "---\ntitle: 42\nowner: team\n---\n\nBody without a heading." } });
  expect(response.status()).toBe(201);
  const original = await response.json();
  const editor = await surface(page, `/w/${workspace}/knowledge/${original.sourceId}/${original.documentId}`);
  await page.route(`**/api/documents/${original.documentId}`, route => route.request().method() === "PATCH" ? route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "REVISION_CONFLICT", message: "Another writer saved this document." } }) }) : route.continue());
  const exactTitle = `Project / Notes : ? ${"長".repeat(130)}`;
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(exactTitle);
  await expect(page.getByRole("button", { name: "Download my changes" })).toBeVisible({ timeout: 15000 });
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download my changes" }).click();
  const download = await pendingDownload;
  const downloaded = await readFile((await download.path())!, "utf8");
  expect(download.suggestedFilename()).toMatch(/\.kh-recovery\.md$/);
  expect(downloaded.startsWith("---\n")).toBe(true);
  const parsed = parseGenericMarkdownText({ sourcePath: download.suggestedFilename(), text: downloaded, sourceFileHash: createHash("sha256").update(downloaded).digest("hex") });
  expect(parsed.resolvedTitle).toBe(exactTitle);
  expect(parsed.metadata).toEqual({ title: 42, owner: "team" });
  expect(parsed.markdown).toBe("\nBody without a heading.");
  const restored = await page.request.post(`/api/workspaces/${workspace}/documents`, { data: { filename: download.suggestedFilename(), markdown: downloaded } });
  expect(restored.status()).toBe(201);
  const copy = await restored.json();
  await page.unrouteAll();
  await page.goto(`/w/${workspace}/knowledge/${copy.sourceId}/${copy.documentId}`);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(exactTitle);
  await expect(editor).toContainText("Body without a heading.");
});

test("a stale draft downloads metadata from its base revision", async ({ page }) => {
  const workspace = await personalWorkspaceId(page);
  const created = await page.request.post(`/api/workspaces/${workspace}/documents`, { data: { filename: "original.md", markdown: "---\ntitle: Original\nowner: current\n---\n\nBody." } });
  expect(created.status()).toBe(201);
  const document = await created.json();
  const draft = await page.request.put(`/api/workspaces/${workspace}/personal`, { data: { key: `draft:${document.documentId}`, value: { title: "Draft title", markdown: "My draft body.", baseRevisionId: document.revisionId }, version: 0 } });
  expect(draft.ok()).toBe(true);
  const changed = await page.request.patch(`/api/documents/${document.documentId}`, { data: { title: "Newer title", markdown: "Newer body.", expectedCurrentRevisionId: document.revisionId, updateMetadataTitle: true } });
  expect(changed.ok()).toBe(true);
  await page.route(`**/api/documents/${document.documentId}/recovery-metadata?*`, route => route.fulfill({ status: 200, json: { revisionId: document.revisionId, metadata: { title: "Original", owner: "base" } } }));
  await page.goto(`/w/${workspace}/knowledge/${document.sourceId}/${document.documentId}`);
  await expect(page.getByText("This document changed while you were away.", { exact: false })).toBeVisible();
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download my changes" }).click();
  const download = await pendingDownload;
  const text = await readFile((await download.path())!, "utf8");
  const parsed = parseGenericMarkdownText({ sourcePath: download.suggestedFilename(), text, sourceFileHash: createHash("sha256").update(text).digest("hex") });
  expect(parsed.resolvedTitle).toBe("Draft title");
  expect(parsed.metadata).toEqual({ title: "Draft title", owner: "base" });
  expect(parsed.markdown).toBe("My draft body.");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  const stored = await page.evaluate(id => {
    const key = Object.keys(sessionStorage).find(item => item.startsWith("kh:draft:edit:") && item.endsWith(`:${id}`));
    return key ? JSON.parse(sessionStorage.getItem(key)!) : null;
  }, document.documentId);
  expect(stored?.baseRevisionId).toBe(document.revisionId);
  await page.reload();
  await expect(page.getByText("This document changed while you were away.", { exact: false })).toBeVisible();
});

test("a stale draft warns when its original metadata is unavailable", async ({ page }) => {
  const { url, id } = await note(page);
  const workspace = await personalWorkspaceId(page);
  const draft = await page.request.put(`/api/workspaces/${workspace}/personal`, { data: { key: `draft:${id}`, value: { title: "Draft title", markdown: "My draft body.", baseRevisionId: randomUUID() }, version: 0 } });
  expect(draft.ok()).toBe(true);
  await page.goto(url);
  await expect(page.getByText("The draft's original metadata is unavailable", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download my changes" })).toBeEnabled();
});

test("inline: opening does not focus, write or require Edit; legacy URLs redirect", async ({ page }) => {
  const { url } = await note(page);
  const writes: string[] = [];
  page.on("request", request => { if (request.method() === "PATCH") writes.push(request.url()); });
  const editor = await surface(page, `${url}/edit`);
  await expect(page).toHaveURL(new RegExp(`${url}$`));
  await expect(editor).not.toBeFocused();
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  await page.waitForTimeout(3500);
  expect(writes).toEqual([]);
});
test("inline: content and title autosave without navigating or losing focus", async ({ page }) => {
  const { url } = await note(page);
  const editor = await surface(page, url);
  const traffic: string[] = [];
  page.on("request", request => {
    if (request.method() === "PUT" && request.url().includes("/personal") || request.headers()["rsc"] === "1" && new URL(request.url()).pathname === url && !request.headers()["next-router-prefetch"]) traffic.push(request.url());
  });
  await editor.fill("Changed inline.");
  await page.waitForTimeout(1500);
  await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "pending");
  await expect(page.locator("[data-autosave-status]")).toHaveText("");
  await saved(page);
  await expect(editor).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`${url}$`));
  await page.getByRole("button", { name: "Rename document" }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeFocused();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Renamed inline");
  await saved(page);
  expect(traffic).toEqual([]);
  await expect(page.locator("[data-autosave-status]")).toHaveText("");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toContainText("Changed inline.");
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Renamed inline");
});
test("inline: slow saves preserve newer typing and serialize PATCH requests", async ({ page }) => {
  const { url, id } = await note(page);
  const editor = await surface(page, url);
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route(`**/api/documents/${id}`, async route => {
    if (route.request().method() !== "PATCH") return route.continue();
    requests++;
    if (requests === 1) await hold;
    await route.continue();
  });
  await editor.fill("First snapshot.");
  await expect.poll(() => requests).toBe(1);
  await expect(editor).toBeEditable();
  await editor.fill("Latest snapshot.");
  await page.waitForTimeout(1300);
  expect(requests).toBe(1);
  await expect(page.locator("[data-autosave-status]")).toHaveText("Saving…");
  release();
  await saved(page);
  expect(requests).toBe(2);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toContainText("Latest snapshot.");
});
test("inline: conflicts keep local text and stop repeated writes", async ({ page }) => {
  const { url, id } = await note(page);
  const editor = await surface(page, url);
  let requests = 0;
  await page.route(`**/api/documents/${id}`, async route => {
    if (route.request().method() !== "PATCH") return route.continue();
    requests++;
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "REVISION_CONFLICT", message: "Another writer saved this document." } }) });
  });
  await editor.fill("My preserved text.");
  await expect(page.getByText("Someone updated this document.", { exact: false })).toBeVisible();
  await editor.fill("Still my text.");
  await page.waitForTimeout(1500);
  expect(requests).toBe(1);
  await expect(editor).toContainText("Still my text.");
  await expect(page.getByRole("button", { name: "Download my changes" })).toBeVisible();
});
test("inline: historical revisions remain read-only", async ({ page }) => {
  const { url } = await note(page);
  await page.goto(`${url}?revision=1`);
  await expect(page.locator("main article")).toContainText("Original paragraph.");
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toHaveCount(0);
});
test("inline: failed saves recover after reload without silently publishing", async ({ page }) => {
  const { url, id } = await note(page);
  const editor = await surface(page, url);
  await page.route(`**/api/documents/${id}`, route => route.request().method() === "PATCH" ? route.abort() : route.continue());
  await editor.fill("Recover me.");
  await expect(editor).toContainText("Recover me.");
  // The write only starts after the 3s autosave debounce; the default 5s left ~1.6s for a parallel run.
  await expect(page.getByRole("button", { name: "Retry save" })).toBeVisible({ timeout: 15000 });
  page.on("dialog", dialog => dialog.accept());
  await page.reload();
  await expect(page.getByRole("button", { name: "Resume saving" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toContainText("Recover me.");
  await page.unroute(`**/api/documents/${id}`);
  await page.getByRole("button", { name: "Resume saving" }).click();
  await saved(page);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toContainText("Recover me.");
});

test("inline: composition does not submit partial input", async ({ page }) => {
  const { url, id } = await note(page);
  const editor = await surface(page, url);
  let writes = 0;
  page.on("request", request => { if (request.method() === "PATCH" && request.url().endsWith(`/api/documents/${id}`)) writes++; });
  await editor.dispatchEvent("compositionstart");
  await editor.fill("中文輸入");
  await page.waitForTimeout(3500);
  expect(writes).toBe(0);
  await editor.dispatchEvent("compositionend");
  await saved(page);
  expect(writes).toBe(1);
});

test("inline: Markdown changes survive switching back to the rendered editor", async ({ page }) => {
  const { url } = await note(page);
  await surface(page, url);
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await page.getByRole("textbox", { name: "Markdown", exact: true }).fill("## A section\n\nSource edit.");
  await saved(page);
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toContainText("Source edit.");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toContainText("Source edit.");
});

test("inline: phone viewport keeps the editor and actions usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { url } = await note(page);
  const editor = await surface(page, url);
  await editor.fill("Written on a phone-sized screen.");
  await saved(page);
  await expect(page.getByRole("button", { name: "Details", exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/inline-editing-mobile.png", fullPage: true });
});

test("inline: saving leaves history, sharing and discussion controls available", async ({ page }) => {
  const { url } = await note(page);
  const editor = await surface(page, url);
  await editor.fill("A fresh revision.");
  await saved(page);
  await page.getByRole("button", { name: "Details", exact: true }).first().click();
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expect(page.getByText("Latest saved content", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share link…" })).toBeVisible();
});

test("inline: continuous typing submits by the maximum wait without account draft writes", async ({ page }) => {
  const { url, id } = await note(page);
  const editor = await surface(page, url);
  let patches = 0;
  let drafts = 0;
  page.on("request", request => {
    if (request.method() === "PATCH" && request.url().endsWith(`/api/documents/${id}`)) patches++;
    if (request.method() === "PUT" && request.url().includes("/personal")) drafts++;
  });
  for (let i = 0; i < 15; i++) {
    await editor.fill(`Continuous typing ${i}`);
    await page.waitForTimeout(1000);
  }
  await expect.poll(() => patches).toBeGreaterThanOrEqual(1);
  await saved(page);
  expect(drafts).toBe(0);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toContainText("Continuous typing 14");
});

test("inline: a failed document save backs up recovery to the account", async ({ page, browser }) => {
  const { url, id } = await note(page);
  const editor = await surface(page, url);
  await page.route(`**/api/documents/${id}`, route => route.request().method() === "PATCH" ? route.abort() : route.continue());
  const backup = page.waitForResponse(response => response.request().method() === "PUT" && response.url().includes("/personal") && response.ok());
  await editor.fill("Account recovery text.");
  await backup;
  const other = await browser.newContext();
  try {
    const second = await other.newPage();
    await second.goto(new URL(url, page.url()).href);
    await expect(second.getByRole("button", { name: "Resume saving" })).toBeVisible({ timeout: 15000 });
    await expect(second.getByRole("textbox", { name: "Content", exact: true })).toContainText("Account recovery text.");
  } finally { await other.close(); }
});


test("inline: action letters type normally in title and body", async ({ page }) => {
  const { url } = await note(page);
  const editor = await surface(page, url);
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("");
  await title.pressSequentially("fmcdre/");
  await expect(title).toHaveValue("fmcdre/");
  await editor.fill("");
  await editor.pressSequentially("fmcdre/");
  await expect(editor).toHaveText("fmcdre/");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`${url}$`));
  await saved(page);
});

test("inline: page chrome and tree leave action letters and slash unbound", async ({ page }) => {
  const { url } = await note(page);
  await surface(page, url);
  // Opening once confirms that the palette's keyboard listener is hydrated.
  await openPalette(page);
  await page.keyboard.press("Escape");
  const row = page.locator('[role="treeitem"][aria-current="page"]').first();
  const details = page.getByRole("button", { name: "Details", exact: true }).filter({ visible: true }).first();
  for (const target of [details, row]) {
    await target.focus();
    for (const key of ["f", "m", "c", "d", "r", "/"]) await page.keyboard.press(key);
    await expect(target).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${url}$`));
  }
  // F did not silently favorite the page, and commands remain accessible.
  await row.click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Add to favorites" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Move document…" })).toBeVisible();
  await expect(menu.locator("kbd")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await openPalette(page);
  const list = page.getByRole("listbox", { name: "Actions and documents" });
  await expect(list.getByRole("option", { name: "Add to favorites" })).toBeVisible();
  await expect(list.getByRole("option", { name: "Create document", exact: true }).locator("kbd")).toHaveCount(0);
});


test("inline: delayed refresh cannot replace a newer acknowledged save", async ({ page }) => {
  const { url } = await note(page);
  const editor = await surface(page, url);
  await editor.fill("Snapshot B.");
  await saved(page);
  let release!: () => void;
  let intercepted!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const fetched = new Promise<void>(resolve => { intercepted = resolve; });
  await page.route(`**${url}?*`, async route => {
    if (route.request().headers()["rsc"] !== "1" || route.request().headers()["next-router-prefetch"]) return route.continue();
    const response = await route.fetch();
    intercepted();
    await held;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Details", exact: true }).first().click();
  await fetched;
  await editor.fill("Newer snapshot C.");
  await editor.press("ControlOrMeta+Enter");
  await saved(page);
  const delivered = page.waitForResponse(response => new URL(response.url()).pathname === url && response.request().headers()["rsc"] === "1");
  release();
  await delivered;
  await page.waitForTimeout(500); // Allow the delayed RSC response to commit.
  await expect(editor).toHaveText("Newer snapshot C.");
  await page.unrouteAll({ behavior: "wait" });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toHaveText("Newer snapshot C.");
});

test("inline: inserting code reveals the caret and Edit code restores focus", async ({ page }) => {
  const { url } = await note(page);
  const editor = await surface(page, url);
  await editor.fill("");
  await editor.pressSequentially("/code");
  await page.getByRole("option", { name: /^Code/ }).click();
  await page.keyboard.type("const answer = 42;");
  await expect(editor.locator("pre:visible")).toHaveText("const answer = 42;");
  await editor.press("ControlOrMeta+Enter");
  await saved(page);
  await page.getByRole("button", { name: "Done editing code", exact: true }).click();
  await page.getByRole("button", { name: "Edit code", exact: true }).click();
  await expect(editor).toBeFocused();
  await page.keyboard.type("// edited ");
  await expect(editor.locator("pre:visible")).toContainText("// edited const answer = 42;");
  await editor.press("ControlOrMeta+Enter");
  await saved(page);
});
