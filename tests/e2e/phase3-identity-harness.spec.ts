import { expect, test } from "@playwright/test";
import { PHASE3_TEAM_ID, phase3Origin, phase3UserId, phase3UnconfiguredOrigin } from "./fixtures/phase3-identities";

test.describe("trusted Phase 3 HTTP identity harness", () => {
  test.skip(!process.env.KM_PHASE3_APP_ROOT, "Run npm run test:e2e to provision the isolated persona applications.");

  test("ordinary production entry cannot enable a fixture reader with environment variables", async ({ playwright }) => {
    const normal = await playwright.request.newContext({ baseURL: phase3UnconfiguredOrigin() });
    try {
      const response = await normal.get("/api/workspaces");
      expect(response.status()).toBe(500);
      expect((await response.json()).error.code).toBe("INTERNAL_ERROR");
    } finally { await normal.dispose(); }
  });

  test("server persona controls Team creation; browser claims cannot elevate a noncreator", async ({ playwright }) => {
    const owner = await playwright.request.newContext({ baseURL: phase3Origin("owner") });
    const ordinary = await playwright.request.newContext({ baseURL: phase3Origin("nonCreator") });
    try {
      const created = await owner.post("/api/workspaces", { data: { name: `Harness ${Date.now()}` } });
      expect(created.status()).toBe(201);
      const denied = await ordinary.post("/api/workspaces?persona=owner&role=OWNER", {
        headers: { "x-user-id": phase3UserId("owner"), "x-external-groups": "phase3-creators", "x-role": "OWNER" },
        data: { name: "Spoof denied", userId: phase3UserId("owner"), externalGroupIds: ["phase3-creators"], platformCapabilities: ["workspace.create_team"], role: "OWNER" },
      });
      expect(denied.status()).toBe(403);
      expect((await denied.json()).error.code).toBe("TEAM_CREATION_DENIED");
      expect((await ordinary.get(`/api/workspaces/${PHASE3_TEAM_ID}`)).status()).toBe(404);
    } finally { await owner.dispose(); await ordinary.dispose(); }
  });

  test("real grant changes propagate between independent fixed server sessions", async ({ playwright }) => {
    const owner = await playwright.request.newContext({ baseURL: phase3Origin("owner") });
    const affected = await playwright.request.newContext({ baseURL: phase3Origin("nonCreator") });
    try {
      const creation = await owner.post("/api/workspaces", { data: { name: `Harness grants ${Date.now()}` } });
      expect(creation.status()).toBe(201);
      const created = await creation.json();
      const workspaceId = created.id;
      expect((await affected.get(`/api/workspaces/${workspaceId}`)).status()).toBe(404);
      const added = await owner.post(`/api/workspaces/${workspaceId}/members`, { data: { userId: phase3UserId("nonCreator"), role: "VIEWER" } });
      expect(added.ok()).toBe(true);
      expect((await affected.get(`/api/workspaces/${workspaceId}`)).status()).toBe(200);
      const removed = await owner.delete(`/api/workspaces/${workspaceId}/members/${phase3UserId("nonCreator")}`);
      expect(removed.ok()).toBe(true);
      expect((await affected.get(`/api/workspaces/${workspaceId}`)).status()).toBe(404);
    } finally { await owner.dispose(); await affected.dispose(); }
  });

  test("group-only and mixed claims reach the real request authorization runtime", async ({ playwright }) => {
    for (const [persona, canOpenSettings, canImport] of [["groupAdmin", true, true], ["groupEditor", false, true], ["mixedEditor", false, true], ["viewer", false, false]] as const) {
      const context = await playwright.request.newContext({ baseURL: phase3Origin(persona) });
      try {
        const response = await context.get(`/api/workspaces/${PHASE3_TEAM_ID}`);
        expect(response.status()).toBe(200);
        const state = await response.json();
        expect(state.actions.canOpenSettings).toBe(canOpenSettings);
        expect(state.actions.canImport).toBe(canImport);
      } finally { await context.dispose(); }
    }
  });
});
