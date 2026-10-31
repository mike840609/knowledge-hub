import { expect, test } from "./fixtures/test";

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
  // Theme is one compact row now, not a vertical list; the three choices share a line.
  const [lightBox, darkBox, systemBox] = await Promise.all([
    page.getByRole("menuitemradio", { name: "Light" }).boundingBox(),
    page.getByRole("menuitemradio", { name: "Dark" }).boundingBox(),
    page.getByRole("menuitemradio", { name: "System" }).boundingBox(),
  ]);
  expect(lightBox && darkBox && systemBox).toBeTruthy();
  expect(Math.abs(lightBox!.y - darkBox!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(darkBox!.y - systemBox!.y)).toBeLessThanOrEqual(1);
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  expect(await theme()).toBe("dark");
  expect(await page.evaluate(() => localStorage.getItem("kh:theme"))).toBe("dark");

  await page.reload();
  expect(await theme()).toBe("dark");

  // Reopening shows which option is current, which a swapping icon could not.
  await page.getByLabel(/^Account: /).click();
  await expect(page.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("menuitemradio", { name: "Light" })).toHaveAttribute("aria-checked", "false");

  // System is the one choice that follows the operating system, and it keeps
  // following it while chosen.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("menuitemradio", { name: "System" }).click();
  expect(await theme()).toBe("dark");
  expect(await page.evaluate(() => localStorage.getItem("kh:theme"))).toBe("system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(theme).toBe("light");
  await page.getByRole("menuitemradio", { name: "Light" }).click();
  expect(await theme()).toBe("light");
});

test("the rails' density is chosen from the user menu, sizes the rows, and persists", async ({ page }) => {
  await page.goto(KNOWLEDGE);
  const density = () => page.evaluate(() => document.documentElement.dataset.density ?? "(none)");
  const graphRow = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Graph" });
  const rowHeight = async () => (await graphRow.boundingBox())?.height;
  const fontSize = () => graphRow.evaluate((element) => getComputedStyle(element).fontSize);

  // Comfortable is the default, before anyone has chosen.
  expect(await density()).toBe("comfortable");
  expect(await rowHeight()).toBe(32);
  expect(await fontSize()).toBe("14px");

  await page.getByLabel(/^Account: /).click();
  await page.getByRole("menuitemradio", { name: "Compact" }).click();
  expect(await density()).toBe("compact");
  expect(await rowHeight()).toBe(28);
  expect(await fontSize()).toBe("13px");
  expect(await page.evaluate(() => localStorage.getItem("kh:density"))).toBe("compact");

  // Stamped before first paint, so a reload opens compact without a step through comfortable.
  await page.reload();
  expect(await density()).toBe("compact");
  expect(await rowHeight()).toBe(28);

  await page.getByLabel(/^Account: /).click();
  await expect(page.getByRole("menuitemradio", { name: "Compact" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemradio", { name: "Comfortable" }).click();
  expect(await rowHeight()).toBe(32);
});

test("Comfortable is offered before Compact in the density row", async ({ page }) => {
  await page.goto(KNOWLEDGE);
  await page.getByLabel(/^Account: /).click();
  const [comfortableBox, compactBox] = await Promise.all([
    page.getByRole("menuitemradio", { name: "Comfortable" }).boundingBox(),
    page.getByRole("menuitemradio", { name: "Compact" }).boundingBox(),
  ]);
  expect(comfortableBox && compactBox).toBeTruthy();
  // Two choices share the row; the default sits first, left to right.
  expect(Math.abs(comfortableBox!.y - compactBox!.y)).toBeLessThanOrEqual(1);
  expect(comfortableBox!.x).toBeLessThan(compactBox!.x);
});

test("the sidebar display options toggle archived mode", async ({ page }) => {
  await page.goto(KNOWLEDGE);
  await page.getByLabel("Document display options", { exact: true }).click();
  const item = page.getByRole("menuitemcheckbox", { name: "Show archived" });
  await expect(item).toHaveAttribute("aria-checked", "false");
  await item.click();
  await expect(page).toHaveURL(/includeArchived=true/);
});
