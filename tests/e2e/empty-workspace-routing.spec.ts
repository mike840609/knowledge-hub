import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";

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

    // The explorer is there too, and says how documents get here and what each way leads to.
    const explorer = page.getByRole("complementary", { name: "Knowledge explorer" });
    const start = explorer.getByRole("region", { name: "Get started" });
    await expect(start.getByText("No documents yet", { exact: true })).toBeVisible();
    await expect(start.getByRole("link")).toHaveText([/^Create document.*edit it any time/, /^Import knowledge.*Read-only here/]);
    await expect(explorer.getByRole("link", { name: "Import folder", exact: true })).toHaveAttribute("href", `/w/${workspace.id}/sources/import`);
    await start.getByRole("link", { name: /^Create document/ }).click();
    await expect(page).toHaveURL(`/w/${workspace.id}/knowledge/new`);
  } finally { await context.close(); }
});
