import { expect, test } from "@playwright/test";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS.
const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const SETTINGS = `/w/${QUERY_MASTER_WORKSPACE}/settings`;

/**
 * The settings sections were plain links with no active state at all, so the
 * page gave no indication of where the reader was — visually or to a screen
 * reader. These guard both halves of the fix.
 */
test("marks the current settings section and no other", async ({ page }) => {
  await page.goto(SETTINGS);
  const nav = page.getByRole("navigation", { name: "Team settings" });
  await expect(nav).toBeVisible();

  await expect(nav.getByRole("link", { name: "General" })).toHaveAttribute("aria-current", "page");
  for (const name of ["Members", "SSO Groups", "Audit"]) {
    await expect(nav.getByRole("link", { name })).not.toHaveAttribute("aria-current", "page");
  }
});

test("moves the marker when the reader changes section", async ({ page }) => {
  await page.goto(SETTINGS);
  const nav = page.getByRole("navigation", { name: "Team settings" });

  await nav.getByRole("link", { name: "Members" }).click();
  await expect(page).toHaveURL(`${SETTINGS}/members`);
  await expect(nav.getByRole("link", { name: "Members" })).toHaveAttribute("aria-current", "page");
  // General sits at the section root, so a prefix match would leave it lit on
  // every page in the section. It must go dark here.
  await expect(nav.getByRole("link", { name: "General" })).not.toHaveAttribute("aria-current", "page");

  await nav.getByRole("link", { name: "SSO Groups" }).click();
  await expect(page).toHaveURL(`${SETTINGS}/groups`);
  await expect(nav.getByRole("link", { name: "SSO Groups" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Members" })).not.toHaveAttribute("aria-current", "page");
});

test("survives a reload rather than depending on client navigation", async ({ page }) => {
  await page.goto(`${SETTINGS}/audit`);
  const nav = page.getByRole("navigation", { name: "Team settings" });
  await expect(nav.getByRole("link", { name: "Audit" })).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(nav.getByRole("link", { name: "Audit" })).toHaveAttribute("aria-current", "page");
});
