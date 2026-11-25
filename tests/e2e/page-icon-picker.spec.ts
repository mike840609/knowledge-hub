import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

const ROUND_TRIP = { timeout: 15_000 };

async function openNote(page: Page) {
  const workspaceId = await mySpace(page);
  const title = `Icon picker ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown: "Some words." } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  await page.goto(`/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(title, ROUND_TRIP);
  return page.locator("main");
}

test("a page with no icon shows none until the header is pointed at or focused", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const main = await openNote(page);
  const trigger = main.getByRole("button", { name: "Add page icon", exact: true });
  // The control exists (and so is a tab stop) but draws nothing at rest, as the read-only page draws nothing.
  await expect(trigger).toHaveCount(1);
  await expect(trigger).toHaveCSS("opacity", "0");
  await expect(main.locator("[data-page-icon]")).toHaveCount(0);
  const rest = await main.getByRole("textbox", { name: "Title", exact: true }).boundingBox();
  await main.locator("header").hover();
  await expect(trigger).toHaveCSS("opacity", "1");
  await expect(trigger).toContainText("Add icon");
  // Showing it moves nothing.
  expect((await main.getByRole("textbox", { name: "Title", exact: true }).boundingBox())!.y).toBeCloseTo(rest!.y, 0);
  await page.mouse.move(5, 5);
  await expect(trigger).toHaveCSS("opacity", "0");
  // Keyboard: focus alone shows it.
  await trigger.focus();
  await expect(trigger).toHaveCSS("opacity", "1");
});

test("the page icon picker searches in English and Chinese and is driven by keys", async ({ page }) => {
  const main = await openNote(page);
  const trigger = main.getByRole("button", { name: "Add page icon", exact: true });
  await trigger.click();

  const search = page.getByRole("searchbox", { name: "Search emoji" });
  await expect(search).toBeFocused();
  // Suggested first, and an emoji appears once with no query.
  await expect(page.getByRole("group", { name: "Suggested" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use 📌", exact: true })).toHaveCount(1);

  await search.fill("COFFEE");
  await expect(page.getByRole("button", { name: "Use ☕", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use 📌", exact: true })).toHaveCount(0);
  await search.fill("火箭");
  await expect(page.locator("button[data-emoji]")).toHaveCount(1);
  await search.fill("zzzz-nothing");
  await expect(page.getByRole("status").filter({ hasText: "No emoji match." })).toBeVisible();

  // Escape closes and returns focus to the trigger.
  await page.keyboard.press("Escape");
  await expect(search).toBeHidden();
  await expect(trigger).toBeFocused();

  // Arrows move through the grid; Enter chooses.
  await trigger.click();
  await expect(search).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const first = page.getByRole("button", { name: "Use 📄", exact: true });
  await expect(first).toBeFocused();
  // Focus is drawn as the ring menu rows use, not only as the hover fill (contrast 1.2:1 against the page).
  await expect(first).not.toHaveCSS("box-shadow", "none");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "Use 📝", exact: true })).toBeFocused();
  await expect(first).toHaveCSS("box-shadow", "none");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: "Use 🎯", exact: true }).or(page.getByRole("button", { name: "Use 🚀", exact: true }))).not.toHaveCount(0);
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("button", { name: "Use 📝", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.locator("button[data-emoji]").last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.getByRole("button", { name: "Use 📄", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  const saved = page.waitForResponse((response) => response.url().endsWith("/icon") && response.request().method() === "PUT");
  await page.keyboard.press("Enter");
  expect((await saved).ok()).toBe(true);
  await expect(main.getByRole("button", { name: "Change page icon", exact: true })).toBeVisible(ROUND_TRIP);
  await expect(main.locator("[data-page-icon]").first()).toHaveText("📝");

  // Roving tabindex: one tab stop in the grid, so one Tab from a cell reaches "Remove icon".
  await main.getByRole("button", { name: "Change page icon", exact: true }).click();
  await expect(page.locator('button[data-emoji][tabindex="0"]')).toHaveCount(1);
  // One roving tab stop; every other cell follows the catalog, which may grow.
  expect(await page.locator('button[data-emoji][tabindex="-1"]').count()).toBe(await page.locator("button[data-emoji]").count() - 1);
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: "Use 📄", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Remove icon", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");

  // A catalog emoji beyond the suggested sixteen is accepted by the server.
  await main.getByRole("button", { name: "Change page icon", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search emoji" }).fill("咖啡");
  const second = page.waitForResponse((response) => response.url().endsWith("/icon") && response.request().method() === "PUT");
  await page.keyboard.press("Enter");
  expect((await second).ok()).toBe(true);
  await expect(main.locator("[data-page-icon]").first()).toHaveText("☕");
});
