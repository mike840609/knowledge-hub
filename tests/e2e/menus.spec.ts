import { expect, test } from "@playwright/test";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS.
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const KNOWLEDGE = `/w/${QUERY_MASTER_WORKSPACE}/knowledge`;

/**
 * Menus are lists of rows, and the contract requires arrow-key navigation on
 * every list of rows. The hand-rolled `<details>` menus these replaced could
 * not offer it, so these cases guard the reason the primitive exists.
 */
test("the workspace menu opens, moves by arrow key, and returns focus on Escape", async ({ page }) => {
  await page.goto(KNOWLEDGE);
  const trigger = page.getByLabel("Workspace: Query Master", { exact: true });
  await trigger.click();

  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();

  await page.keyboard.press("ArrowDown");
  const first = menu.getByRole("menuitem").first();
  await expect(first).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(first).not.toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("the archived teams submenu is reachable and reports when it is empty", async ({ page }) => {
  await page.goto(KNOWLEDGE);
  await page.getByLabel("Workspace: Query Master", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Archived", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "No archived teams" })).toBeVisible();
});

test("the theme is chosen from the user menu and persists", async ({ page }) => {
  await page.goto(KNOWLEDGE);
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme ?? "(none)");
  expect(await theme()).toBe("light");

  await page.getByLabel(/^Account: /).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  expect(await theme()).toBe("dark");
  expect(await page.evaluate(() => localStorage.getItem("kh:theme"))).toBe("dark");

  await page.reload();
  expect(await theme()).toBe("dark");

  // Reopening shows which option is current, which a swapping icon could not.
  await page.getByLabel(/^Account: /).click();
  await expect(page.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("menuitemradio", { name: "Light" })).toHaveAttribute("aria-checked", "false");
});

test("the sidebar display options toggle archived mode", async ({ page }) => {
  await page.goto(KNOWLEDGE);
  await page.getByLabel("Document display options", { exact: true }).click();
  const item = page.getByRole("menuitemcheckbox", { name: "Show archived" });
  await expect(item).toHaveAttribute("aria-checked", "false");
  await item.click();
  await expect(page).toHaveURL(/includeArchived=true/);
});
