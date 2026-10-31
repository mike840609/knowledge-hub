import { expect, test, type Page } from "./fixtures/test";
import { openPalette } from "./fixtures/palette";

async function personalWorkspaceId(page: Page): Promise<string> {
  const nav = await (await page.request.get("/api/workspaces")).json();
  return nav.items.find((workspace: { type: string }) => workspace.type === "PERSONAL").id;
}

const openImport = (page: Page) =>
  page.locator("main.kh-page").getByRole("link", { name: "Import folder", exact: true }).first().click();

test("Import folder opens over Sources; Escape and Back return to the list", async ({ page }) => {
  const ws = await personalWorkspaceId(page);
  await page.goto(`/w/${ws}/sources`);
  const surface = page.locator("main.kh-page");
  await expect(surface).toBeVisible();

  await openImport(page);
  const dialog = page.getByRole("dialog", { name: "Import folder", exact: true });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/w/${ws}/sources/import$`));
  await expect(surface).toBeVisible();
  await expect(dialog.getByLabel("Source name")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Choose folder", exact: true })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/w/${ws}/sources$`));

  await openImport(page);
  await expect(dialog).toBeVisible();
  await page.goBack();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/w/${ws}/sources$`));
});

test("a direct /sources/import load is still the full page", async ({ page }) => {
  const ws = await personalWorkspaceId(page);
  await page.goto(`/w/${ws}/sources/import`);
  await expect(page.getByRole("dialog", { name: "Import folder", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Import folder", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose folder", exact: true })).toBeVisible();
});

test("the sample wiki runs inside the dialog and lands on Preview", async ({ page }) => {
  const ws = await personalWorkspaceId(page);
  await page.goto(`/w/${ws}/sources`);
  await openImport(page);
  const dialog = page.getByRole("dialog", { name: "Import folder", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("group", { name: "Try with a sample wiki" }).getByRole("button", { name: "English", exact: true }).click();
  await expect(page).toHaveURL(/\/sources\/imports\//, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
});

test("a client navigation from Knowledge keeps the full page", async ({ page }) => {
  const ws = await personalWorkspaceId(page);
  await page.goto(`/w/${ws}/knowledge`);
  const field = await openPalette(page);
  await field.fill("Import knowledge");
  const option = page
    .getByRole("listbox", { name: "Actions and documents" })
    .getByRole("option", { name: /Import (knowledge|your first knowledge source)/ })
    .first();
  await option.click();
  await expect(page).toHaveURL(new RegExp(`/sources/import$`));
  await expect(page.getByRole("dialog", { name: "Import folder", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Import folder", exact: true })).toBeVisible();
});

test("a global import action from Preview opens the full page", async ({ page }) => {
  const ws = await personalWorkspaceId(page);
  await page.goto(`/w/${ws}/sources`);
  await openImport(page);
  const dialog = page.getByRole("dialog", { name: "Import folder", exact: true });
  await dialog.getByRole("group", { name: "Try with a sample wiki" }).getByRole("button", { name: "English", exact: true }).click();
  await expect(page).toHaveURL(/\/sources\/imports\//, { timeout: 15_000 });
  const field = await openPalette(page);
  await field.fill("Import knowledge");
  await page.getByRole("listbox", { name: "Actions and documents" }).getByRole("option", { name: /Import (knowledge|your first knowledge source)/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/w/${ws}/sources/import$`));
  await expect(page.getByRole("dialog", { name: "Import folder", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Import folder", exact: true })).toBeVisible();
});

test("Back from Preview after a modal import returns to Sources", async ({ page }) => {
  const ws = await personalWorkspaceId(page);
  await page.goto(`/w/${ws}/sources`);
  await openImport(page);
  const dialog = page.getByRole("dialog", { name: "Import folder", exact: true });
  await dialog.getByRole("group", { name: "Try with a sample wiki" }).getByRole("button", { name: "English", exact: true }).click();
  await expect(page).toHaveURL(/\/sources\/imports\//, { timeout: 15_000 });
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/w/${ws}/sources$`));
  await expect(page.getByRole("dialog", { name: "Import folder", exact: true })).toHaveCount(0);
});

test("the dialog fits a phone viewport", async ({ page }) => {
  const ws = await personalWorkspaceId(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/w/${ws}/sources`);
  await openImport(page);
  const dialog = page.getByRole("dialog", { name: "Import folder", exact: true });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(390);
  await expect(dialog.getByRole("button", { name: "Choose folder", exact: true })).toBeInViewport();
});

test("refreshing an applied preview opens the full import page", async ({ page }) => {
  const ws = await personalWorkspaceId(page);
  await page.goto(`/w/${ws}/sources`);
  await openImport(page);
  await page.getByRole("dialog", { name: "Import folder" }).getByRole("button", { name: "English", exact: true }).click();
  await expect(page).toHaveURL(/\/sources\/imports\//);
  const preview = page.url();
  await page.getByRole("button", { name: "Apply changes" }).click();
  await expect(page).toHaveURL(/\/runs\//);
  await page.goto(preview);
  await page.getByRole("link", { name: "Refresh preview" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${ws}/sources/import$`));
  await expect(page.getByRole("dialog", { name: "Import folder" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Import folder" })).toBeVisible();
});

for (const stage of ["entries", "finalize"] as const) {
  test(`locks dismissal and abandons the session when ${stage} is cancelled`, async ({ page }) => {
    const ws = await personalWorkspaceId(page);
    let unblock!: () => void;
    const gate = new Promise<void>((resolve) => { unblock = resolve; });
    let arrived!: () => void;
    const reached = new Promise<void>((resolve) => { arrived = resolve; });
    await page.route(`**/api/source-imports/*/${stage}`, async (route) => {
      arrived();
      await gate;
      await route.abort().catch(() => {});
    });
    await page.goto(`/w/${ws}/sources`);
    await openImport(page);
    const dialog = page.getByRole("dialog", { name: "Import folder" });
    await dialog.getByRole("button", { name: "English", exact: true }).click();
    await reached;
    const close = dialog.getByRole("button", { name: "Close dialog" });
    await expect(close).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.mouse.click(5, 5);
    await expect(dialog).toBeVisible();
    const deleted = page.waitForResponse((response) => response.request().method() === "DELETE" && /\/api\/source-imports\/[^/]+$/.test(new URL(response.url()).pathname));
    await dialog.getByRole("button", { name: "Cancel import" }).click();
    unblock();
    const response = await deleted;
    expect(await response.json()).toEqual({ abandoned: true });
    await expect(close).toBeEnabled();
    await close.click();
    await expect(dialog).toBeHidden();
  });
}
