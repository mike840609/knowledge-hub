import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { KnowledgeQueryServiceImpl } from "@/modules/knowledge/application/knowledge-query-service";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { WorkspaceQueryService } from "@/modules/workspaces/application/workspace-query-service";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { WorkspaceAccessDeniedError } from "@/modules/workspaces/domain/errors";
import { uuidv7 } from "@/shared/ids/uuidv7";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const alice: UserIdentity = { id: "00000000-0000-0000-0000-000000000701", emp_id: "WS-ALICE", name: "Alice", org_code: "HRSD" };
const bob: UserIdentity = { id: "00000000-0000-0000-0000-000000000702", emp_id: "WS-BOB", name: "Bob", org_code: "RD" };
const carol: UserIdentity = { id: "00000000-0000-0000-0000-000000000703", emp_id: "WS-CAROL", name: "Carol", org_code: "HRSD" };

describe("Workspace access boundary", () => {
  it("allows cross-org members, denies same-org non-members, and lists multiple workspaces", async () => {
    const uow = new MariaDbUnitOfWork(pool);
    const workspaceX = uuidv7();
    const workspaceY = uuidv7();
    const sourceId = uuidv7();
    const folderId = uuidv7();
    const now = new Date();
    await uow.run(async (repositories) => {
      for (const user of [alice, bob, carol]) await repositories.users.upsertIdentity(user);
      await repositories.workspaces.insert({ id: workspaceX, name: "Cross Org X", createdAt: now, updatedAt: now });
      await repositories.workspaces.insert({ id: workspaceY, name: "Bob Only Y", createdAt: now, updatedAt: now });
      await repositories.workspaceMemberships.insert({ workspaceId: workspaceX, userId: alice.id, createdAt: now });
      await repositories.workspaceMemberships.insert({ workspaceId: workspaceX, userId: bob.id, createdAt: now });
      await repositories.workspaceMemberships.insert({ workspaceId: workspaceY, userId: bob.id, createdAt: now });
      await repositories.sources.insert({ id: sourceId, name: "Shared Hub", workspaceId: workspaceX, sourceType: "HUB", ownership: "HUB_MANAGED", status: "ACTIVE", syncVersion: 0, createdBy: alice.id, updatedBy: alice.id, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now });
      await repositories.tree.insert({ id: folderId, sourceId, parentId: null, nodeType: "FOLDER", name: "Shared Folder", documentId: null, position: 0, status: "ACTIVE", updatedBy: alice.id, archivedBy: null, archivedAt: null });
    });
    await expect(pool.query("INSERT INTO workspace_memberships (workspace_id, user_id) VALUES (?, ?)", [workspaceX, alice.id])).rejects.toBeTruthy();
    await expect(pool.query("INSERT INTO knowledge_sources (id, name, workspace_id, source_type, ownership, status, sync_version, created_by, updated_by) VALUES (?, 'Invalid', ?, 'HUB', 'HUB_MANAGED', 'ACTIVE', 0, ?, ?)", [uuidv7(), uuidv7(), alice.id, alice.id])).rejects.toBeTruthy();

    const aliceCaller = callerFromIdentity(alice);
    const bobCaller = callerFromIdentity(bob);
    const carolCaller = callerFromIdentity(carol);
    const workspaceQuery = new WorkspaceQueryService(uow);
    expect((await workspaceQuery.listWorkspaces(bobCaller)).map((workspace) => workspace.id)).toEqual(expect.arrayContaining([workspaceX, workspaceY]));
    expect(await workspaceQuery.listWorkspaces(carolCaller)).toEqual([]);

    const bobQueries = new KnowledgeQueryServiceImpl(uow);
    const hub = new HubKnowledgeCommandServiceImpl(uow);
    const created = await hub.createDocument(aliceCaller, { sourceId, parentId: folderId, title: "Shared", markdown: "body", metadata: {} });
    await expect(bobQueries.getDocument(bobCaller, created.documentId)).resolves.toMatchObject({ documentId: created.documentId });
    await expect(bobQueries.listTree(bobCaller, sourceId)).resolves.toHaveLength(2);

    const carolQueries = new KnowledgeQueryServiceImpl(uow);
    await expect(carolQueries.getDocument(carolCaller, created.documentId)).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    await expect(carolQueries.listTree(carolCaller, sourceId)).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);

    expect(await bobQueries.listSources(bobCaller, workspaceX)).toHaveLength(1);
    await expect(carolQueries.listSources(carolCaller, workspaceX)).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
  });

  it("keeps Workspace membership when a user's org identity changes", async () => {
    const workspaceId = uuidv7();
    const now = new Date();
    const uow = new MariaDbUnitOfWork(pool);
    await uow.run(async (repositories) => {
      await repositories.users.upsertIdentity({ ...alice, org_code: "NEW-ORG" });
      await repositories.workspaces.insert({ id: workspaceId, name: "Identity Change", createdAt: now, updatedAt: now });
      await repositories.workspaceMemberships.insert({ workspaceId, userId: alice.id, createdAt: now });
      expect(await repositories.workspaceMemberships.find(workspaceId, alice.id)).not.toBeNull();
    });
    const workspaces = await new WorkspaceQueryService(uow).listWorkspaces(callerFromIdentity({ ...alice, org_code: "NEW-ORG" }));
    expect(workspaces.some((workspace) => workspace.id === workspaceId)).toBe(true);
  });
});
