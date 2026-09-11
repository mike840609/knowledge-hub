import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { WorkspaceAccessDeniedError } from "@/modules/workspaces/domain/errors";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";

const hrMember: UserIdentity = { id: "0199f200-0000-7000-8000-000000000001", emp_id: "WS-HR", name: "HR Member", org_code: "HRSD" };
const rdMember: UserIdentity = { id: "0199f200-0000-7000-8000-000000000002", emp_id: "WS-RD", name: "RD Member", org_code: "RD" };
const hrOutsider: UserIdentity = { id: "0199f200-0000-7000-8000-000000000003", emp_id: "WS-HR-OUT", name: "HR Outsider", org_code: "HRSD" };

let handle: IsolatedDatabaseHandle;
let pool: Pool;

beforeAll(async () => {
  handle = await provisionIsolatedDatabase("test");
  const previous = process.env.KM_TEST_DB_NAME;
  process.env.KM_TEST_DB_NAME = handle.databaseName;
  try {
    pool = createDatabasePool(databaseConfig("test"));
  } finally {
    if (previous === undefined) delete process.env.KM_TEST_DB_NAME;
    else process.env.KM_TEST_DB_NAME = previous;
  }
  await runMigrations(pool);
});

afterAll(async () => {
  await pool.end();
  await disposeIsolatedDatabase(handle);
});

async function setupWorkspaceScope(): Promise<{ workspaceX: string; workspaceY: string; sourceX: string; folderX: string }> {
  const workspaceX = uuidv7();
  const workspaceY = uuidv7();
  const sourceX = uuidv7();
  const folderX = uuidv7();
  const now = new Date();
  await new MariaDbUnitOfWork(pool).run(async (repositories) => {
    for (const user of [hrMember, rdMember, hrOutsider]) await repositories.users.upsertIdentity(user);
    await repositories.workspaces.insert({ id: workspaceX, name: "Shared X", createdAt: now, updatedAt: now });
    await repositories.workspaces.insert({ id: workspaceY, name: "RD Only Y", createdAt: now, updatedAt: now });
    await repositories.workspaceMemberships.insert({ workspaceId: workspaceX, userId: hrMember.id, createdAt: now });
    await repositories.workspaceMemberships.insert({ workspaceId: workspaceX, userId: rdMember.id, createdAt: now });
    await repositories.workspaceMemberships.insert({ workspaceId: workspaceY, userId: rdMember.id, createdAt: now });
    await repositories.sources.insert({
      id: sourceX, name: "Shared Hub", workspaceId: workspaceX, sourceType: "HUB", ownership: "HUB_MANAGED",
      status: "ACTIVE", syncVersion: 0, createdBy: hrMember.id, updatedBy: hrMember.id,
      archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
    });
    await repositories.tree.insert({
      id: folderX, sourceId: sourceX, parentId: null, nodeType: "FOLDER", name: "Shared Folder",
      documentId: null, position: 0, status: "ACTIVE", updatedBy: hrMember.id, archivedBy: null, archivedAt: null,
    });
  });
  return { workspaceX, workspaceY, sourceX, folderX };
}

describe("hub command workspace access", () => {
  it("allows a cross-org member to create documents and revisions", async () => {
    const scope = await setupWorkspaceScope();
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    const created = await hub.createDocument(callerFromIdentity(rdMember), {
      sourceId: scope.sourceX, parentId: scope.folderX,
      title: "Cross Org", markdown: "body", metadata: {},
    });
    const revised = await hub.createRevision(callerFromIdentity(rdMember), {
      documentId: created.documentId, expectedCurrentRevisionId: created.revisionId,
      title: "Cross Org", markdown: "v2", metadata: {},
    });
    expect(revised).toEqual({ revisionId: expect.any(String), revisionNo: 2, changed: true });
  });

  it("denies a same-org non-member on Hub writes", async () => {
    const scope = await setupWorkspaceScope();
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    const outsider = callerFromIdentity(hrOutsider);
    await expect(
      hub.createDocument(outsider, { sourceId: scope.sourceX, parentId: scope.folderX, title: "No", markdown: "no", metadata: {} }),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    const created = await hub.createDocument(callerFromIdentity(hrMember), {
      sourceId: scope.sourceX, parentId: scope.folderX, title: "Mine", markdown: "body", metadata: {},
    });
    await expect(
      hub.createRevision(outsider, {
        documentId: created.documentId, expectedCurrentRevisionId: created.revisionId,
        title: "Mine", markdown: "hijacked", metadata: {},
      }),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    const rows = await pool.query<{ count: number }[]>("SELECT COUNT(*) AS count FROM knowledge_revisions WHERE document_id = ?", [created.documentId]);
    expect(Number(rows[0]?.count ?? 0)).toBe(1);
  });

  it("rejects direct-UUID revision access without leaking content", async () => {
    const scope = await setupWorkspaceScope();
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    const created = await hub.createDocument(callerFromIdentity(hrMember), {
      sourceId: scope.sourceX, parentId: scope.folderX, title: "Secret", markdown: "secret body", metadata: {},
    });
    const failure = await hub.createRevision(callerFromIdentity(hrOutsider), {
      documentId: created.documentId, expectedCurrentRevisionId: created.revisionId,
      title: "Secret", markdown: "probed", metadata: {},
    }).then(
      (): null => null,
      (caught: unknown) => caught,
    );
    expect(failure).toBeInstanceOf(WorkspaceAccessDeniedError);
    expect(String((failure as Error).message)).not.toContain("secret body");
  });

  it("serves a caller who belongs to two workspaces in each scope", async () => {
    const scope = await setupWorkspaceScope();
    const secondSource = uuidv7();
    const secondFolder = uuidv7();
    const now = new Date();
    await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      await repositories.sources.insert({
        id: secondSource, name: "Second Hub", workspaceId: scope.workspaceY, sourceType: "HUB", ownership: "HUB_MANAGED",
        status: "ACTIVE", syncVersion: 0, createdBy: rdMember.id, updatedBy: rdMember.id,
        archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
      });
      await repositories.tree.insert({
        id: secondFolder, sourceId: secondSource, parentId: null, nodeType: "FOLDER", name: "Second Folder",
        documentId: null, position: 0, status: "ACTIVE", updatedBy: rdMember.id, archivedBy: null, archivedAt: null,
      });
    });
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    const first = await hub.createDocument(callerFromIdentity(rdMember), {
      sourceId: scope.sourceX, parentId: scope.folderX, title: "In X", markdown: "x", metadata: {},
    });
    const second = await hub.createDocument(callerFromIdentity(rdMember), {
      sourceId: secondSource, parentId: secondFolder, title: "In Y", markdown: "y", metadata: {},
    });
    expect(first.documentId).not.toBe(second.documentId);
    await expect(
      hub.createDocument(callerFromIdentity(hrMember), {
        sourceId: secondSource, parentId: secondFolder, title: "No", markdown: "no", metadata: {},
      }),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
  });
});
