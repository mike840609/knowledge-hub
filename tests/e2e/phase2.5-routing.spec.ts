import { expect, test } from "./fixtures/test";

const QUERY_MASTER_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const OBSIDIAN_SOURCE = "0199f100-0000-7000-8000-000000000101";

test("root resolves deterministically into My Space", { tag: ["@smoke-team", "@smoke-personal"] }, async ({ page }) => {
  await page.goto("/");
  const navigation = await (await page.request.get("/api/workspaces")).json();
  const personal = navigation.items.find((item: { type: string }) => item.type === "PERSONAL");
  const personalOnly = process.env.KM_TEAM_WORKSPACES_ENABLED === "false";
  await expect(page).toHaveURL(new RegExp(`/w/${personal.id}/${personalOnly ? "home$" : "knowledge(?:/|$)"}`));
  await expect(page.getByLabel("Workspace: My Space", { exact: true })).toBeVisible();
  // Routing does not depend on whether earlier specs populated this workspace.
  await expect(page.getByRole("navigation", { name: "Primary", exact: true })
    .getByRole("link", { name: "Knowledge", exact: true })).toBeVisible();
});

test.describe("Team-enabled fixture routes", () => {
  test.skip(process.env.KM_TEAM_WORKSPACES_ENABLED === "false", "Team fixture routes require Team-enabled mode.");

  test("source-only route resolves the first readable Document", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}`);
    await expect(page).toHaveURL(
      new RegExp(`/w/${QUERY_MASTER_WORKSPACE}/knowledge/${OBSIDIAN_SOURCE}/[0-9a-f-]+`),
    );
  });

  test("renders the persistent Workspace shell", async ({ page }) => {
    await page.goto(`/w/${QUERY_MASTER_WORKSPACE}/knowledge`);
    await expect(page.getByText("Knowledge Hub", { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByLabel("Workspace: Query Master", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Knowledge" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sources" })).toBeVisible();
    await expect(page.getByText(/Organization:/)).toHaveCount(0);
  });
});
