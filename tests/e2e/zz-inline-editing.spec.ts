import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId } from "./fixtures/my-space";

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
    if (request.method() === "PUT" && request.url().includes("/personal") || request.headers()["rsc"] === "1") traffic.push(request.url());
  });
  await editor.fill("Changed inline.");
  await page.waitForTimeout(1500);
  await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "pending");
  await expect(page.locator("[data-autosave-status]")).toHaveText("");
  await saved(page);
  await expect(editor).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`${url}$`));
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
  await expect(page.getByRole("button", { name: "Retry save" })).toBeVisible();
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
  await expect(page.getByRole("link", { name: /Revision 2/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share link…" })).toBeVisible();
});
