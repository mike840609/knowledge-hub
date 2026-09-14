import { expect, test } from "@playwright/test";

const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const OBSIDIAN_SOURCE = "0199f100-0000-7000-8000-000000000101";

test("sources list renders compact rows", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/sources`);

  await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Obsidian Wiki/ })).toBeVisible();
  await expect(page.getByText("All sources", { exact: false })).toHaveCount(0);
});

test("source detail renders overview and hides folder update for a Hub-managed source", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/sources/${OBSIDIAN_SOURCE}`);

  await expect(page.getByRole("heading", { name: "Obsidian Wiki" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Update from folder" })).toHaveCount(0);
  await expect(page.getByText("Technical details")).toBeVisible();
});
