import { expect, test } from "@playwright/test";

const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const OBSIDIAN_SOURCE = "0199f100-0000-7000-8000-000000000101";

test("root resolves into the first accessible Workspace knowledge route", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(
    new RegExp(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}/[0-9a-f-]+`),
  );
});

test("source-only route resolves the first readable Document", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}`);
  await expect(page).toHaveURL(
    new RegExp(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}/[0-9a-f-]+`),
  );
});

test("renders the persistent Workspace shell", async ({ page }) => {
  await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge`);
  await expect(page.getByText("Knowledge Hub", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Workspace")).toHaveValue(QUERY_MASTER_WORKSPACE);
  await expect(page.getByRole("link", { name: "Knowledge" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sources" })).toBeVisible();
  await expect(page.getByText(/Organization:/)).toHaveCount(0);
});
