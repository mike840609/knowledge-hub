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
  } finally { await context.close(); }
});
