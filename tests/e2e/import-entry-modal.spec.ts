import { expect, test, type Page } from "./fixtures/test";

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
