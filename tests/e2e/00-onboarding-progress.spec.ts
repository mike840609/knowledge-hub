import { test, expect } from "./fixtures/test";
import { mkdir } from "node:fs/promises";
import { stageReadingFolder } from "./fixtures/folder-reading";

test("onboarding follows real actions and persists progress across browser sessions", async ({ page, request, browser }) => {
  const nav = await (await request.get("/api/workspaces")).json();
  const ws = nav.items.find((item: { type: string }) => item.type === "PERSONAL").id;
  const endpoint = `/api/workspaces/${ws}/onboarding`;
  const initial = await (await request.get(endpoint)).json();
  expect((await request.put(endpoint, { data: { value: { schemaVersion: 1, dismissed: false }, version: initial.version } })).ok()).toBe(true);
  await mkdir("docs/ui-comparisons/onboarding-progress", { recursive: true });
  const home = async () => { await page.goto(`/w/${ws}/home`); };
  const guide = page.getByRole("region", { name: "Get started", exact: true });
  await home();
  await expect(guide.getByText("0 of 4 steps complete", { exact: false })).toBeVisible();
  await expect(guide.getByRole("link", { name: "Import your first folder", exact: true })).toBeVisible();
  for (const [name, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: `docs/ui-comparisons/onboarding-progress/before-import-${name}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const snapshot = await stageReadingFolder(request, { workspaceId: ws, sourceName: "Tutorial progress folder", fixture: "reading-flow-v1" });
  await home();
  await expect(guide.getByText("0 of 4 steps complete", { exact: false })).toBeVisible(); // Preview is not an import.
  const applied = await (await request.post(`/api/source-imports/${snapshot}/apply`, { data: {} })).json();
  expect(applied.kind).toBe("APPLIED");
  await home();
  await expect(guide.getByText("1 of 4 steps complete", { exact: false })).toBeVisible();
  await guide.getByRole("link", { name: "Prepare AI context" }).click();
  await expect(page).toHaveURL(/\/agent-context$/);
  await page.goto(`/w/${ws}/search?scope=workspace`);
  await home();
  await expect(guide.getByText("1 of 4 steps complete", { exact: false })).toBeVisible();
  expect((await request.post(`/api/workspaces/${ws}/agent-context`, { data: { documentIds: [] } })).status()).toBe(400);
  const readResponse = page.waitForResponse(response => response.url().includes(`/api/workspaces/${ws}/documents/`) && response.url().endsWith("/read") && response.status() === 204);
  await guide.getByRole("link", { name: "Read your first document" }).click();
  await readResponse;
  await home();
  await expect(guide.getByText("2 of 4 steps complete", { exact: false })).toBeVisible();
  await page.goto(`/w/${ws}/search?scope=workspace&q=Team`);
  await home();
  await expect(guide.getByText("3 of 4 steps complete", { exact: false })).toBeVisible();
  await guide.getByRole("link", { name: "Prepare AI context" }).click();
  await page.getByLabel("Find documents").fill("Tutorial progress folder");
  await page.getByRole("checkbox", { name: /^Select / }).first().check();
  await page.getByRole("button", { name: "Prepare context", exact: true }).click();
  await expect(page.getByLabel("Markdown preview")).toBeVisible();
  await home();
  await expect(guide.getByText("4 of 4 steps complete", { exact: false })).toBeVisible();
  for (const [name, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: `docs/ui-comparisons/onboarding-progress/completed-${name}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const other = await browser.newContext();
  const resumed = await other.newPage();
  await resumed.goto(`${new URL(page.url()).origin}/w/${ws}/home`);
  await expect(resumed.getByText("4 of 4 steps complete", { exact: false })).toBeVisible();
  await other.close();
});
