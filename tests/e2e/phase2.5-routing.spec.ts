import { expect, test } from "@playwright/test";
import { phase3Origin } from "./fixtures/phase3-identities";

const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const OBSIDIAN_SOURCE = "0199f100-0000-7000-8000-000000000101";

test("root resolves deterministically into My Space", async ({ page }) => {
  await page.goto("/");
  const navigation = await (await page.request.get("/api/workspaces")).json();
  const personal = navigation.items.find((item: { type: string }) => item.type === "PERSONAL");
  await expect(page).toHaveURL(new RegExp(`/w/${personal.id}/knowledge(?:/|$)`));
  await expect(page.getByLabel("Workspace: My Space", { exact: true })).toBeVisible();
});

test("an empty workspace offers its first import regardless of other test data", async ({ browser }) => {
  test.skip(!process.env.KM_PHASE3_APP_ROOT, "Requires the isolated Company SSO server to create a fresh Team.");
  const context = await browser.newContext({ baseURL: phase3Origin("owner") });
  try {
    const created = await context.request.post("/api/workspaces", { data: { name: `Empty routing fixture ${Date.now()}` } });
    expect(created.status()).toBe(201);
    const workspace = await created.json();
    const page = await context.newPage();
    await page.goto(`/w/${workspace.id}/knowledge`);
    await expect(page.getByRole("heading", { name: "No documents yet", exact: true })).toBeVisible();
    const importLink = page.getByRole("link", { name: "Import knowledge", exact: true });
    await expect(importLink).toBeVisible();
    await expect(importLink).toHaveAttribute("href", `/w/${workspace.id}/sources/import`);
  } finally { await context.close(); }
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
  await expect(page.getByLabel("Workspace: Query Master", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Knowledge" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sources" })).toBeVisible();
  await expect(page.getByText(/Organization:/)).toHaveCount(0);
});
