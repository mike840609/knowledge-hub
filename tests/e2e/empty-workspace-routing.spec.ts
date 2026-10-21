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

    // The page says once what each way in leads to; the explorer is there too, but does not offer them a second time.
    await expect(page.getByText("Imported folders stay read-only here; documents you write stay editable.", { exact: true })).toBeVisible();
    const explorer = page.getByRole("complementary", { name: "Knowledge explorer" });
    await expect(explorer.getByText("No documents yet", { exact: true })).toBeVisible();
    await expect(explorer.getByRole("region", { name: "Get started" })).toHaveCount(0);
    await expect(explorer.getByRole("link", { name: "Import folder", exact: true })).toHaveAttribute("href", `/w/${workspace.id}/sources/import`);
    await page.getByRole("link", { name: "Create document", exact: true }).click();
    await expect(page).toHaveURL(`/w/${workspace.id}/knowledge/new`);
  } finally { await context.close(); }
});
