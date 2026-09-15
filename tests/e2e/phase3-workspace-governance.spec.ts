import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext } from "@playwright/test";
import { phase3Origin, phase3UserId, type Phase3Persona } from "./fixtures/phase3-identities";

async function session(browser: Browser, persona: Phase3Persona) {
  const context = await browser.newContext({ baseURL: phase3Origin(persona) });
  return { context, page: await context.newPage() };
}
async function createTeam(request: APIRequestContext, name = `UI acceptance ${Date.now()}`) {
  const response = await request.post("/api/workspaces", { data: { name } });
  expect(response.status()).toBe(201);
  return (await response.json()).id as string;
}
async function grant(request: APIRequestContext, workspaceId: string, persona: Phase3Persona, role: string) {
  expect((await request.post(`/api/workspaces/${workspaceId}/members`, { data: { userId: phase3UserId(persona), role } })).ok()).toBe(true);
}
async function group(request: APIRequestContext, workspaceId: string, externalGroupId: string, role: string) {
  expect((await request.post(`/api/workspaces/${workspaceId}/groups`, { data: { externalGroupId, role } })).ok()).toBe(true);
}
async function refresh(context: BrowserContext) {
  for (const page of context.pages()) await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

test.describe("Phase 3 Workspace product acceptance", () => {
  test.skip(!process.env.KM_PHASE3_APP_ROOT, "Use the isolated HTTP harness via npm run test:e2e.");

  test("My Space, Create Team, empty group/member forms, archive/restore and audit are operable", async ({ browser }, testInfo) => {
    const { context, page } = await session(browser, "owner");
    try {
      await page.goto("/");
      await expect(page).toHaveURL(/\/w\/[^/]+\/knowledge$/);
      await expect(page.getByRole("link", { name: "Import your first knowledge source" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
      await page.getByLabel("Workspace: My Space", { exact: true }).click();
      await expect(page.getByText("Teams", { exact: true })).toBeVisible();
      await expect(page.getByText("Archived", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Create team", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Team name").fill("UI closure team");
      await dialog.getByRole("button", { name: "Create team", exact: true }).click();
      await expect(page.getByRole("link", { name: "Import knowledge", exact: true })).toBeVisible();
      const workspaceId = new URL(page.url()).pathname.split("/")[2]!;
      await page.goto(`/w/${workspaceId}/settings/groups`);
      await expect(page.getByText("No SSO group mappings yet.")).toBeVisible();
      await expect(page.getByLabel("New group role").locator("option")).toHaveText(["ADMIN", "EDITOR", "VIEWER"]);
      await page.getByLabel("External group ID").fill("phase3-ui-viewers");
      await page.getByLabel("New group role").selectOption("VIEWER");
      await page.getByRole("button", { name: "Add group mapping", exact: true }).click();
      await expect(page.getByRole("cell", { name: "phase3-ui-viewers", exact: true })).toBeVisible();
      await page.goto(`/w/${workspaceId}/settings/members`);
      await page.getByLabel("Search existing users").fill("P3-105");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.getByLabel("User to add").selectOption(phase3UserId("viewer"));
      await expect(page.getByLabel("New member role").locator("option")).toHaveText(["OWNER", "ADMIN", "EDITOR", "VIEWER"]);
      await page.getByLabel("New member role").selectOption("VIEWER");
      await page.getByRole("button", { name: "Add member", exact: true }).click();
      await expect(page.getByRole("row").filter({ hasText: "Phase3 viewer" })).toContainText("Group access not evaluated");
      await page.screenshot({ path: testInfo.outputPath("phase3-members.png"), fullPage: true });
      await page.goto(`/w/${workspaceId}/settings`);
      await page.getByLabel("Team name").fill("Renamed UI team");
      await page.getByRole("button", { name: "Save name" }).click();
      await expect(page.getByLabel("Workspace: Renamed UI team", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Archive workspace", exact: true }).click();
      await page.getByRole("button", { name: "Confirm archive" }).click();
      await expect(page.getByText("State: ARCHIVED")).toBeVisible();
      await expect(page.getByRole("button", { name: "Save name" })).toHaveCount(0);
      await page.getByRole("button", { name: "Restore workspace", exact: true }).first().click();
      await expect(page.getByText("State: ACTIVE")).toBeVisible();
      await page.goto(`/w/${workspaceId}/settings/audit`);
      await expect(page.getByRole("heading", { name: "Audit", exact: true })).toBeVisible();
      await expect(page.locator("main").first()).toContainText(/archive/i);
    } finally { await context.close(); }
  });

  test("ADMIN creation options and API ceilings; VIEWER has no import/Settings entry", async ({ browser }) => {
    const owner = await session(browser, "owner"); const admin = await session(browser, "admin"); const viewer = await session(browser, "viewer");
    try {
      const id = await createTeam(owner.context.request);
      await grant(owner.context.request, id, "admin", "ADMIN");
      await grant(owner.context.request, id, "viewer", "VIEWER");
      await admin.page.goto(`/w/${id}/settings/groups`);
      await expect(admin.page.getByLabel("New group role").locator("option")).toHaveText(["EDITOR", "VIEWER"]);
      await admin.page.goto(`/w/${id}/settings/members`);
      await admin.page.getByLabel("Search existing users").fill("P3-102");
      await admin.page.getByRole("button", { name: "Search", exact: true }).click();
      await expect(admin.page.getByLabel("New member role").locator("option")).toHaveText(["EDITOR", "VIEWER"]);
      const denied = await admin.context.request.post(`/api/workspaces/${id}/archive`);
      expect(denied.status()).toBe(403);
      await viewer.page.goto(`/w/${id}/knowledge`);
      await expect(viewer.page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
      await expect(viewer.page.getByRole("link", { name: "Sources", exact: true })).toHaveCount(0);
      await expect(viewer.page.getByRole("link", { name: "Import knowledge" })).toHaveCount(0);
      await viewer.page.goto(`/w/${id}/sources/import`);
      await expect(viewer.page.locator('input[type="file"]')).toHaveCount(0);
      await viewer.page.goto("/");
      await viewer.page.getByLabel("Workspace: My Space", { exact: true }).click();
      await expect(viewer.page.getByRole("button", { name: "Create team", exact: true })).toHaveCount(0);
    } finally { await owner.context.close(); await admin.context.close(); await viewer.context.close(); }
  });

  test("affected visible client discovers revoke on polling and clears scope on return to My Space", async ({ browser }) => {
    const owner = await session(browser, "owner"); const affected = await session(browser, "editor");
    try {
      const id = await createTeam(owner.context.request);
      await grant(owner.context.request, id, "editor", "EDITOR");
      await affected.page.clock.install();
      await affected.page.goto(`/w/${id}/sources/import`);
      await expect(affected.page.locator('input[type="file"]')).toBeVisible();
      expect((await owner.context.request.delete(`/api/workspaces/${id}/members/${phase3UserId("editor")}`)).ok()).toBe(true);
      await affected.page.clock.fastForward(30_001);
      await expect(affected.page.getByRole("status").filter({ hasText: "You no longer have access to this workspace." })).toBeVisible();
      await expect(affected.page).toHaveURL(/\/knowledge$/);
      expect(affected.page.url()).not.toContain(id);
      await expect(affected.page.locator('input[type="file"]')).toHaveCount(0);
      await affected.page.getByLabel("Workspace: My Space", { exact: true }).click();
      const navigation = await (await affected.context.request.get("/api/workspaces")).json();
      expect(navigation.items.some((item: { id: string }) => item.id === id)).toBe(false);
    } finally { await owner.context.close(); await affected.context.close(); }
  });

  test("Settings demotion with group VIEWER remaining converges to same Team Knowledge", async ({ browser }) => {
    const owner = await session(browser, "owner"); const affected = await session(browser, "mixedEditor");
    try {
      const id = await createTeam(owner.context.request);
      await grant(owner.context.request, id, "mixedEditor", "ADMIN");
      await group(owner.context.request, id, "phase3-viewers", "VIEWER");
      await affected.page.goto(`/w/${id}/settings/members`);
      await expect(affected.page.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
      expect((await owner.context.request.delete(`/api/workspaces/${id}/members/${phase3UserId("mixedEditor")}`)).ok()).toBe(true);
      await refresh(affected.context);
      await expect(affected.page).toHaveURL(new RegExp(`/w/${id}/knowledge$`));
      await expect(affected.page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
      await expect(affected.page.getByRole("link", { name: "Import knowledge", exact: true })).toHaveCount(0);
    } finally { await owner.context.close(); await affected.context.close(); }
  });

  test("network failures pause mutation without false revoke, then focus recovers", async ({ browser }) => {
    const owner = await session(browser, "owner");
    try {
      const id = await createTeam(owner.context.request);
      await owner.page.goto(`/w/${id}/sources/import`);
      await expect(owner.page.locator('input[type="file"]')).toBeVisible();
      await owner.page.route("**/api/workspaces", route => route.fulfill({ status: 503, body: "Unavailable" }));
      await refresh(owner.context);
      await expect(owner.page.getByRole("alert").filter({ hasText: "Unable to confirm workspace access" })).toBeVisible();
      await expect(owner.page).toHaveURL(new RegExp(`/w/${id}/sources/import$`));
      await expect(owner.page.locator('input[type="file"]')).toHaveCount(0);
      await owner.page.unroute("**/api/workspaces");
      await owner.page.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(owner.page.locator('input[type="file"]')).toBeVisible();
    } finally { await owner.context.close(); }
  });

  test("open import preview becomes read-only after archive and server rejects Apply", async ({ browser }) => {
    const owner = await session(browser, "owner"); const affected = await session(browser, "editor");
    const folder = await mkdtemp(path.join(tmpdir(), "phase3-folder-"));
    await writeFile(path.join(folder, "readme.md"), "# Phase 3\n\nImported knowledge.");
    try {
      const id = await createTeam(owner.context.request);
      await grant(owner.context.request, id, "editor", "EDITOR");
      await affected.page.goto(`/w/${id}/sources/import`);
      await affected.page.getByLabel("Source name").fill("Folder flow");
      const input = affected.page.locator('input[type="file"]');
      await input.setInputFiles(folder);
      await expect(affected.page.getByRole("heading", { name: "Import preview", exact: true })).toBeVisible();
      await expect(affected.page.getByRole("button", { name: "Apply changes" })).toBeEnabled();
      const snapshot = new URL(affected.page.url()).pathname.split("/").at(-1)!;
      expect((await owner.context.request.post(`/api/workspaces/${id}/archive`)).ok()).toBe(true);
      await refresh(affected.context);
      await expect(affected.page.getByRole("button", { name: "Apply changes" })).toHaveCount(0);
      const denied = await affected.context.request.post(`/api/source-imports/${snapshot}/apply`);
      expect(denied.ok()).toBe(false);
      await affected.page.goto(`/w/${id}/sources/import`);
      await expect(affected.page.locator('input[type="file"]')).toHaveCount(0);
      expect((await owner.context.request.post(`/api/workspaces/${id}/restore`)).ok()).toBe(true);
      await affected.page.goto(`/w/${id}/sources/imports/${snapshot}`);
      await affected.page.getByRole("button", { name: "Apply changes" }).click();
      await expect(affected.page.getByText("Import applied successfully.")).toBeVisible();
      await expect(affected.page.getByRole("link", { name: "Update from folder" })).toBeVisible();
      await affected.page.getByRole("link", { name: "Knowledge", exact: true }).click();
      await expect(affected.page.locator("main").first()).toContainText("Imported knowledge.");
    } finally { await owner.context.close(); await affected.context.close(); await rm(folder, { recursive: true, force: true }); }
  });

  test("Create dialog handles a revoked platform capability without submitting again", async ({ browser }) => {
    const owner = await session(browser, "owner");
    try {
      await owner.page.goto("/");
      await owner.page.getByLabel("Workspace: My Space", { exact: true }).click();
      await owner.page.getByRole("button", { name: "Create team", exact: true }).click();
      const dialog = owner.page.getByRole("dialog");
      await dialog.getByLabel("Team name").fill("Capability expired");
      // Simulate a newly denied session at the HTTP boundary; real denied creation is covered by the fixed nonCreator persona.
      await owner.page.route("**/api/workspaces", async route => {
        if (route.request().method() === "POST") {
          await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "TEAM_CREATION_DENIED", message: "Team creation is unavailable." } }) });
        } else {
          // The denied submit triggers two overlapping refreshes (explicit dialog refresh
          // plus the global access-check listener); the superseded fetch is aborted and its
          // response disposed. Only the surviving refresh needs to complete.
          try {
            const response = await route.fetch();
            await route.fulfill({ response, json: { ...await response.json(), canCreateTeam: false } });
          } catch {
            await route.abort().catch(() => {});
          }
        }
      });
      await dialog.getByRole("button", { name: "Create team", exact: true }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Create team", exact: true })).toBeDisabled();
      await expect(dialog.getByText("Team creation is unavailable.")).toBeVisible();
    } finally { await owner.context.close(); }
  });

  test("a delayed old capability response cannot restore controls after archive", async ({ browser }) => {
    const owner = await session(browser, "owner");
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    try {
      const id = await createTeam(owner.context.request);
      await owner.page.goto(`/w/${id}/sources/import`);
      await expect(owner.page.locator('input[type="file"]')).toBeVisible();
      let held = false;
      let intercepted = false;
      await owner.page.route(`**/api/workspaces/${id}`, async route => {
        if (held) { await route.continue(); return; }
        held = true;
        const response = await route.fetch();
        intercepted = true;
        await gate;
        await route.fulfill({ response }).catch(() => {}); // First refresh is deliberately aborted by the next one.
      });
      await refresh(owner.context);
      await expect.poll(() => intercepted).toBe(true);
      expect((await owner.context.request.post(`/api/workspaces/${id}/archive`)).ok()).toBe(true);
      await refresh(owner.context);
      await expect(owner.page.getByLabel("Archived workspace", { exact: true })).toBeVisible();
      release();
      await expect(owner.page.locator('input[type="file"]')).toHaveCount(0);
      await expect(owner.page.getByRole("link", { name: "Sources", exact: true })).toBeVisible();
    } finally { release(); await owner.context.close(); }
  });

});
