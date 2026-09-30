import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "mariadb";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { buildApplicationServices } from "@/server/composition";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { restoreRevision } from "@/modules/knowledge/application/restore-revision";
import { workspaceExport } from "@/server/knowledge-export";
import { provisionIsolatedDatabase, disposeIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";
import { uuidv7 } from "@/shared/ids/uuidv7";
let handle: IsolatedDatabaseHandle; let pool: Pool; let services: ReturnType<typeof buildApplicationServices>;
beforeEach(async () => {
  handle = await provisionIsolatedDatabase("test"); pool = createDatabasePool({ ...databaseConfig("test"), database: handle.databaseName }); await runMigrations(pool);
  vi.stubEnv("KM_TEAM_WORKSPACES_ENABLED", "false"); vi.stubEnv("KM_IDENTITY_PROVIDER", "local"); vi.stubEnv("KM_LOCAL_IDENTITY_ENABLED", "true");
  vi.stubEnv("KM_LOCAL_ID", uuidv7()); vi.stubEnv("KM_LOCAL_EMP_ID", "PERSONAL-TEST"); vi.stubEnv("KM_LOCAL_NAME", "Personal test"); vi.stubEnv("KM_LOCAL_ORG_CODE", "TEST");
  services = buildApplicationServices(pool);
});
afterEach(async () => { vi.unstubAllEnvs(); await pool.end(); await disposeIsolatedDatabase(handle); });
async function setup() {
  const { caller, personalWorkspace } = await services.establishTrustedCaller();
  const sourceId = await ensureDefaultHubSource(services.unitOfWork, caller, personalWorkspace.id);
  const doc = await services.hub.createDocument(caller, { sourceId, parentId: null, title: "First", markdown: "Original", metadata: { tags: ["work"] } });
  return { caller, workspaceId: personalWorkspace.id, sourceId, doc };
}
describe("personal workspace flows", () => {
  it("persists drafts, rejects stale saves, and retains tombstone versions", async () => {
    const { caller, workspaceId, doc } = await setup(); const key = `draft:${doc.documentId}`;
    await expect(services.personal.put(caller, workspaceId, "", { favorite: true }, 0)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    const value = { title: "Draft", markdown: "Not published", baseRevisionId: doc.revisionId };
    await services.personal.put(caller, workspaceId, key, value, 0);
    expect((await services.personal.get(caller, workspaceId, key)).value).toEqual(value);
    await expect(services.personal.put(caller, workspaceId, key, { ...value, markdown: "stale" }, 0)).rejects.toMatchObject({ code: "PERSONAL_ITEM_CONFLICT" });
    expect((await services.queries.getCurrentRevision(caller, doc.documentId)).markdown).toBe("Original");
    await services.personal.put(caller, workspaceId, key, null, 1);
    expect(await services.personal.get(caller, workspaceId, key)).toMatchObject({ value: null, version: 2 });
    await expect(services.personal.put(caller, workspaceId, key, value, 1)).rejects.toMatchObject({ code: "PERSONAL_ITEM_CONFLICT" });
  });
  it("isolates personal data and syncs favorite identity", async () => {
    const { caller, workspaceId, doc, sourceId } = await setup();
    await services.personal.put(caller, workspaceId, `favorite:${doc.documentId}`, { favorite: true }, 0);
    expect(await services.personal.list(caller, workspaceId)).toEqual([expect.objectContaining({ key: `favorite:${doc.documentId}`, sourceId })]);
    const other = { ...caller, identity: { ...caller.identity, id: uuidv7() }, personalWorkspaceOnly: uuidv7() };
    await expect(services.personal.list(other, workspaceId)).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
  });
  it("organizes, archives and restores without changing document identity; restores immutable revisions", async () => {
    const { caller, workspaceId, sourceId, doc } = await setup();
    const folder = await services.hub.createFolder(caller, { sourceId, parentId: null, name: "Projects" });
    await services.hub.moveTreeNode(caller, { nodeId: doc.treeNodeId, newParentId: folder.treeNodeId, newPosition: 0 });
    await services.hub.archiveDocument(caller, doc.documentId);
    await services.hub.restoreDocument(caller, doc.documentId);
    const edited = await services.hub.createRevision(caller, { documentId: doc.documentId, expectedCurrentRevisionId: doc.revisionId, title: "Second", markdown: "Edited", metadata: {} });
    await restoreRevision(services.queries, services.hub, caller, { documentId: doc.documentId, revisionNo: 1, expectedCurrentRevisionId: edited.revisionId });
    const revisions = await services.queries.listRevisions(caller, doc.documentId);
    expect(revisions).toHaveLength(3); expect(revisions.find(r => r.revisionNo === 1)?.id).toBe(doc.revisionId);
    expect((await services.queries.getCurrentRevision(caller, doc.documentId)).markdown).toBe("Original");
    await expect(restoreRevision(services.queries, services.hub, caller, { documentId: doc.documentId, revisionNo: 2, expectedCurrentRevisionId: edited.revisionId })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const zip = Buffer.from(await workspaceExport(services.queries, caller, workspaceId));
    expect(zip.includes(Buffer.from("Projects"))).toBe(true); expect(zip.includes(Buffer.from("manifest.json"))).toBe(true); expect(zip.includes(Buffer.from("Original"))).toBe(true);
  });
  it("hides pre-existing teams from navigation, direct reads and creation; reopening preserves data", async () => {
    const { caller } = await setup(); const privileged = { ...caller, personalWorkspaceOnly: undefined, platformCapabilities: ["workspace.create_team" as const] };
    const team = await services.teams.createTeamWorkspace(privileged, { name: "Existing team" });
    const sourceId = await ensureDefaultHubSource(services.unitOfWork, privileged, team.id);
    const doc = await services.hub.createDocument(privileged, { sourceId, parentId: null, title: "Team secret", markdown: "Secret", metadata: {} });
    expect((await services.workspaceAdmin.navigation(caller)).items.some(i => i.id === team.id)).toBe(false);
    await expect(services.queries.getCurrentRevision(caller, doc.documentId)).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
    await expect(services.hub.archiveDocument(caller, doc.documentId)).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
    await expect(workspaceExport(services.queries, caller, team.id)).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
    vi.stubEnv("KM_TEAM_WORKSPACES_ENABLED", "true");
    const reopened = (await services.establishTrustedCaller()).caller;
    expect((await services.workspaceAdmin.navigation(reopened)).items.some(i => i.id === team.id)).toBe(true);
    expect((await services.queries.getCurrentRevision(reopened, doc.documentId)).markdown).toBe("Secret");
  });
});
