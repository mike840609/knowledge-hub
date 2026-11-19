import { expect, test, type Page } from "./fixtures/test";
import { teamsClosedOrigin } from "./fixtures/teams-closed";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS: a Team workspace the E2E user belongs to.
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";

async function openSwitcher(page: Page, current: string) {
  await page.getByLabel(`Workspace: ${current}`, { exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
}

test.describe("with Team workspaces closed", () => {
  test.use({ baseURL: teamsClosedOrigin() });

  test("the switcher is omitted on desktop, the compact rail, and mobile Menu", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page).toHaveURL(/\/w\/[^/]+\/home$/);
    const switcher = page.getByLabel("Workspace: My Space", { exact: true });
    const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
    await expect(switcher).toHaveCount(0);
    await expect(sidebar.getByRole("button", { name: "Search ⌘K" })).toBeVisible();

    await sidebar.getByRole("button", { name: "Collapse navigation" }).click();
    await expect(sidebar.getByRole("button", { name: "Expand navigation" })).toBeVisible();
    await expect(switcher).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open menu" }).click();
    const menu = page.getByRole("dialog", { name: "Menu", exact: true });
    await expect(menu.getByRole("button", { name: "Search ⌘K" })).toBeVisible();
    await expect(menu.getByRole("navigation", { name: "Document tree" })).toBeVisible();
    await expect(switcher).toHaveCount(0);
  });

  test("a direct Team link is denied while workspaces are closed", async ({ page }) => {
    const response = await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge`);
    expect(response?.status()).toBe(404);
    const navigation = await (await page.request.get("/api/workspaces")).json();
    expect(navigation.items.some((item: { id: string }) => item.id === QUERY_MASTER_WORKSPACE)).toBe(false);
  });
});

test.describe("with Team workspaces open (the control)", () => {
  test("the switcher lists the team and offers the Archived section", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/w\/[^/]+\/knowledge/);
    await openSwitcher(page, "My Space");
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Query Master" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Archived", exact: true })).toBeVisible();
  });
});
