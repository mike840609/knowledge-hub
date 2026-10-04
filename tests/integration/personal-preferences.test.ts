import { beforeAll, afterAll, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { provisionIsolatedDatabase, disposeIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createSourceFixture, fixtureCaller, fixtureIdentity, secondFixtureIdentity } from "../fixtures/knowledge";
import { buildApplicationServices } from "@/server/composition";
let handle: IsolatedDatabaseHandle, pool: Pool, services: ReturnType<typeof buildApplicationServices>, workspaceId: string;
beforeAll(async () => {
  handle = await provisionIsolatedDatabase("test");
  pool = createDatabasePool({ ...databaseConfig("test"), database: handle.databaseName });
  await runMigrations(pool);
  ({ workspaceId } = await createSourceFixture(pool));
  await pool.query("UPDATE workspaces SET name='My Space',workspace_type='PERSONAL',personal_owner_user_id=? WHERE id=?", [fixtureIdentity.id, workspaceId]);
  services = buildApplicationServices(pool);
});
afterAll(async () => { await pool?.end(); if (handle) await disposeIsolatedDatabase(handle); });
it("persists separate feature namespaces and prevents concurrent lost updates", async () => {
  const preferences = services.personalPreferences;
  expect(await preferences.get(fixtureCaller(), workspaceId, "prefs:onboarding")).toMatchObject({ value: null, version: 0 });
  await preferences.put(fixtureCaller(), workspaceId, "prefs:onboarding", { dismissed: true }, 0);
  await preferences.put(fixtureCaller(), workspaceId, "prefs:freshness", { days: 14 }, 0);
  const outcomes = await Promise.allSettled([
    preferences.put(fixtureCaller(), workspaceId, "prefs:freshness", { days: 7 }, 1),
    preferences.put(fixtureCaller(), workspaceId, "prefs:freshness", { days: 30 }, 1),
  ]);
  expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter(result => result.status === "rejected")).toMatchObject([{ reason: { code: "PERSONAL_ITEM_CONFLICT" } }]);
  const restored = buildApplicationServices(pool);
  expect(await restored.personalPreferences.get(fixtureCaller(), workspaceId, "prefs:onboarding")).toMatchObject({ value: { dismissed: true }, version: 1 });
  expect(await restored.personalPreferences.get(fixtureCaller(), workspaceId, "prefs:freshness")).toMatchObject({ version: 2 });
  expect(await restored.personal.list(fixtureCaller(), workspaceId)).toEqual([]);
});
it("denies other users and Team workspaces before accessing preferences", async () => {
  await expect(services.personalPreferences.get(fixtureCaller(secondFixtureIdentity), workspaceId, "prefs:onboarding")).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
  const team = await createSourceFixture(pool);
  await expect(services.personalPreferences.put(fixtureCaller(), team.workspaceId, "prefs:freshness", { days: 7 }, 0)).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
});
