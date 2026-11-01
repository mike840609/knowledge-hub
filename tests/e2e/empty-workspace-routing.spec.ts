import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";

test("an empty team offers publishing, not the Hub's authoring, regardless of other test data", async ({ browser }) => {
  test.skip(!process.env.KM_PHASE3_APP_ROOT, "Requires the isolated Company SSO server to create a fresh Team.");
  const context = await browser.newContext({ baseURL: phase3Origin("owner") });
  try {
    const created = await context.request.post("/api/workspaces", { data: { name: `Empty routing fixture ${Date.now()}` } });
    expect(created.status()).toBe(201);
    const workspace = await created.json();
    const page = await context.newPage();
    await page.goto(`/w/${workspace.id}/knowledge`);
    await expect(page.getByRole("heading", { name: "No documents yet", exact: true })).toBeVisible();
    // Publishing is the only UI way content enters a team; no import or create entry is offered.
    await expect(page.getByText(/團隊的內容從成員的 My Space 發佈而來/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Import knowledge", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Create document", exact: true })).toHaveCount(0);
    const explorer = page.getByRole("complementary", { name: "Knowledge explorer" });
    await expect(explorer.getByRole("region", { name: "Get started" })).toHaveCount(0);
    await expect(explorer.getByRole("link", { name: "Import folder", exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});
