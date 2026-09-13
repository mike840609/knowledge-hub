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
