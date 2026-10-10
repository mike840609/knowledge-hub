import { expect, test, type Page } from "./fixtures/test";
import { teamsClosedOrigin } from "./fixtures/teams-closed";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS: a Team workspace the E2E user belongs to.
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";

/**
 * Team workspaces are announced and not yet open: the workspace switcher says "Coming soon" where they
 * will be and takes nobody to one. Every other spec runs with them open; this one looks at both — the
 * server that has them closed (started by playwright.config.ts) and, as its control, the one that has
 * them open — so that "there is no Query Master in the menu" is a fact about the flag and not about a
 * menu that never had it.
 *
 * A closed Team is also denied by trusted-caller authorization. The switcher is the visible explanation;
 * the direct-link case below checks the server boundary.
 */

async function openSwitcher(page: Page, current: string) {
  await page.getByLabel(`Workspace: ${current}`, { exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
}

test.describe("with Team workspaces closed", () => {
  test.use({ baseURL: teamsClosedOrigin() });

  test("the switcher says they are coming, and offers none of them", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/w\/[^/]+\/home/);
    await openSwitcher(page, "My Space");
    const menu = page.getByRole("menu");

    // Where they will be: one row, disabled, that says so.
    const soon = menu.getByRole("menuitem", { name: /Team workspaces/ });
    await expect(soon).toBeVisible();
    await expect(soon).toHaveAttribute("aria-disabled", "true");
    await expect(soon).toContainText("Coming soon");

    // And nothing that takes anyone to one: not the team this user is in, not the archived list, not creating one.
    await expect(menu.getByRole("menuitem", { name: "Query Master" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Archived", exact: true })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Create team" })).toHaveCount(0);

    // Clicking the announcement goes nowhere.
    const before = page.url();
    await soon.click({ force: true });
    expect(page.url()).toBe(before);
  });

  test("My Space is still the workspace, and is still there to choose", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/w\/[^/]+\/home/);
    await openSwitcher(page, "My Space");
    await page.getByRole("menuitem", { name: "My Space" }).click();
    await expect(page).toHaveURL(/\/w\/[^/]+\/knowledge/);
  });

  test("a direct Team link is denied while workspaces are closed", async ({ page }) => {
    const response = await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge`);
    expect(response?.status()).toBe(404);
    const navigation = await (await page.request.get("/api/workspaces")).json();
    expect(navigation.items.some((item: { id: string }) => item.id === QUERY_MASTER_WORKSPACE)).toBe(false);
  });
});

test.describe("with Team workspaces open (the control)", () => {
  test("the switcher lists the team, has the Archived section, and says nothing is coming", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/w\/[^/]+\/knowledge/);
    await openSwitcher(page, "My Space");
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Query Master" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Archived", exact: true })).toBeVisible();
    await expect(menu.getByText("Coming soon")).toHaveCount(0);
  });
});
