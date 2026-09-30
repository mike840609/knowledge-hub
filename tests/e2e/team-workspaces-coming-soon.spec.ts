import { expect, test, type Page } from "@playwright/test";
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
 * What is held here is what the switcher offers. It is not access control: a Team workspace's own
 * rules are the services', and a link to one still opens it — which is checked too, so that nobody
 * takes this for a lock.
 */

async function openSwitcher(page: Page, current: string) {
  await page.getByLabel(`Workspace: ${current}`, { exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
}

test.describe("with Team workspaces closed", () => {
  test.use({ baseURL: teamsClosedOrigin() });

  test("the switcher says they are coming, and offers none of them", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/w\/[^/]+\/knowledge/);
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
    await page.waitForURL(/\/w\/[^/]+\/knowledge/);
    const home = page.url();
    await openSwitcher(page, "My Space");
    await page.getByRole("menuitem", { name: "My Space" }).click();
    await expect(page).toHaveURL(home);
  });

  test("a link into a Team workspace still opens it, and the switcher there still lets the reader leave", async ({ page }) => {
    // The switcher is not a lock: this is here so that nobody reads it as one.
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge`);
    await expect(page.getByLabel("Workspace: Query Master", { exact: true })).toBeVisible();
    await openSwitcher(page, "Query Master");
    await expect(page.getByRole("menuitem", { name: /Team workspaces/ })).toContainText("Coming soon");
    await page.getByRole("menuitem", { name: "My Space" }).click();
    await expect(page).toHaveURL(/\/w\/(?!0199f100-0000-7000-8000-000000000001)[^/]+\/knowledge/);
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
