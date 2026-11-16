import { expect, test } from "./fixtures/test";

const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";

test("an address that matches nothing counts down, then lands on the reader's workspace", async ({ page }) => {
  await page.goto("/no-such-page");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.getByText(/Taking you to your workspace in \d seconds?…/)).toBeVisible();
  await expect(page).toHaveURL(/\/w\/[^/]+\/(home|knowledge)$/, { timeout: 10_000 });
});

test("a missing document inside a workspace offers ways out and stays put", async ({ page }) => {
  const url = `/w/${QUERY_MASTER_WORKSPACE}/knowledge/00000000-0000-4000-8000-000000000000`;
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Not found or no access" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to my workspace" })).toHaveAttribute("href", "/");
  await page.waitForTimeout(4_000);
  await expect(page).toHaveURL(new RegExp(`${url}$`));
  await page.getByRole("link", { name: "Back to this workspace" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${QUERY_MASTER_WORKSPACE}/knowledge$`));
});
