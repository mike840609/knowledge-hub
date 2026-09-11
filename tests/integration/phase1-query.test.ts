import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { KnowledgeQueryServiceImpl } from "@/modules/knowledge/application/knowledge-query-service";
import { SourceApplicationService } from "@/modules/sources/application/source-version-guard";
import { WorkspaceQueryService } from "@/modules/workspaces/application/workspace-query-service";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { WorkspaceAccessDeniedError } from "@/modules/workspaces/domain/errors";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";

const hrMember: UserIdentity = { id: "0199f400-0000-7000-8000-000000000001", emp_id: "Q-HR", name: "Query HR", org_code: "HRSD" };
const rdMember: UserIdentity = { id: "0199f400-0000-7000-8000-000000000002", emp_id: "Q-RD", name: "Query RD", org_code: "RD" };
const hrOutsider: UserIdentity = { id: "0199f400-0000-7000-8000-000000000003", emp_id: "Q-HR-OUT", name: "Query Outsider", org_code: "HRSD" };

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

type QueryScope = {
  workspaceX: string;
  workspaceY: string;
  sourceX: string;
  folderX: string;
  documentId: string;
  documentNodeId: string;
  childFolderId: string;
};

async function setupQueryScope(): Promise<QueryScope> {
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
  const unitOfWork = new MariaDbUnitOfWork(pool);
  const hub = new HubKnowledgeCommandServiceImpl(unitOfWork);
  const member = callerFromIdentity(hrMember);
  const child = await hub.createFolder(member, { sourceId: sourceX, parentId: folderX, name: "Child Folder" });
  const created = await hub.createDocument(member, {
    sourceId: sourceX, parentId: child.treeNodeId, title: "Secret Title", markdown: "secret body", metadata: {},
  });
  await hub.createRevision(member, {
    documentId: created.documentId, expectedCurrentRevisionId: created.revisionId,
    title: "Secret Title", markdown: "secret body v2", metadata: {},
  });
  return { workspaceX, workspaceY, sourceX, folderX, documentId: created.documentId, documentNodeId: created.treeNodeId, childFolderId: child.treeNodeId };
}

function queryServices() {
  const unitOfWork = new MariaDbUnitOfWork(pool);
  return {
    queries: new KnowledgeQueryServiceImpl(unitOfWork),
    workspaces: new WorkspaceQueryService(unitOfWork),
    sources: new SourceApplicationService(unitOfWork),
    hub: new HubKnowledgeCommandServiceImpl(unitOfWork),
  };
}

describe("knowledge query workspace access", () => {
  it("lets a cross-org member read while hiding the workspace from a same-org non-member", async () => {
    const scope = await setupQueryScope();
    const { queries, workspaces } = queryServices();
    const member = callerFromIdentity(rdMember);
    const outsider = callerFromIdentity(hrOutsider);

    expect((await workspaces.listWorkspaces(member)).map((workspace) => workspace.id)).toContain(scope.workspaceX);
    expect((await workspaces.listWorkspaces(outsider)).map((workspace) => workspace.id)).not.toContain(scope.workspaceX);

    await expect(queries.getSource(member, scope.sourceX)).resolves.toMatchObject({ id: scope.sourceX, workspaceId: scope.workspaceX });
    await expect(queries.getDocument(member, scope.documentId)).resolves.toMatchObject({ documentId: scope.documentId });
    await expect(queries.listTree(member, scope.sourceX)).resolves.toHaveLength(3);
    await expect(queries.listSources(member, scope.workspaceX)).resolves.toHaveLength(1);

    await expect(queries.getSource(outsider, scope.sourceX)).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    await expect(queries.getDocument(outsider, scope.documentId)).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    await expect(queries.listTree(outsider, scope.sourceX)).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    await expect(queries.listSources(outsider, scope.workspaceX)).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
  });

  it("serves a caller who belongs to two workspaces in each scope", async () => {
    const scope = await setupQueryScope();
    const { queries, workspaces } = queryServices();
    const member = callerFromIdentity(rdMember);
    const listed = await workspaces.listWorkspaces(member);
    expect(listed.map((workspace) => workspace.id)).toEqual(expect.arrayContaining([scope.workspaceX, scope.workspaceY]));
    await expect(queries.listSources(member, scope.workspaceX)).resolves.toHaveLength(1);
    await expect(queries.listSources(member, scope.workspaceY)).resolves.toEqual([]);
  });

  it("rejects mandatory workspace scope and known unauthorized UUIDs without leaking content", async () => {
    const scope = await setupQueryScope();
    const { queries } = queryServices();
    const outsider = callerFromIdentity(hrOutsider);

    await expect(queries.listSources(outsider, uuidv7())).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);

    const denied: Array<Promise<unknown>> = [
      queries.getSource(outsider, scope.sourceX),
      queries.getDocument(outsider, scope.documentId),
      queries.getCurrentRevision(outsider, scope.documentId),
      queries.getRevision(outsider, scope.documentId, 1),
      queries.listRevisions(outsider, scope.documentId),
      queries.listTree(outsider, scope.sourceX),
      queries.getAncestors(outsider, scope.documentNodeId),
    ];
    const settled = await Promise.allSettled(denied);
    expect(settled).toHaveLength(7);
    for (const outcome of settled) {
      expect(outcome.status).toBe("rejected");
      const failure = (outcome as PromiseRejectedResult).reason as Error;
      expect(failure).toBeInstanceOf(WorkspaceAccessDeniedError);
      expect(String(failure.message)).not.toContain("Secret Title");
      expect(String(failure.message)).not.toContain("secret body");
    }
  });

  it("serves a non-Web caller from a trusted CallerContext", async () => {
    const scope = await setupQueryScope();
    const { queries } = queryServices();
    const agentCaller = callerFromIdentity({ id: "0199f400-0000-7000-8000-000000000009", emp_id: "AGENT-01", name: "Agent", org_code: "AGENT" });
    await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      await repositories.users.upsertIdentity(agentCaller.identity);
      await repositories.workspaceMemberships.insert({ workspaceId: scope.workspaceX, userId: agentCaller.identity.id, createdAt: new Date() });
    });
    await expect(queries.listSources(agentCaller, scope.workspaceX)).resolves.toHaveLength(1);
    await expect(queries.getDocument(agentCaller, scope.documentId)).resolves.toMatchObject({ documentId: scope.documentId });
  });
});

describe("knowledge query archived filtering", () => {
  it("hides archived sources, tree nodes, and documents by default while preserving history", async () => {
    const scope = await setupQueryScope();
    const { queries, hub, sources } = queryServices();
    const member = callerFromIdentity(hrMember);

    await hub.archiveDocument(member, scope.documentId);
    await expect(queries.getDocument(member, scope.documentId)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(queries.getCurrentRevision(member, scope.documentId)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(queries.listRevisions(member, scope.documentId)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    expect((await queries.listTree(member, scope.sourceX)).some((item) => item.type === "document")).toBe(false);

    const archivedView = await queries.getDocument(member, scope.documentId, { includeArchived: true });
    expect(archivedView.status).toBe("ARCHIVED");
    expect(archivedView.currentRevision.title).toBe("Secret Title");
    expect(await queries.listRevisions(member, scope.documentId, { includeArchived: true })).toHaveLength(2);

    await sources.archiveSource(member, scope.sourceX);
    expect(await queries.listSources(member, scope.workspaceX)).toEqual([]);
    expect(await queries.listTree(member, scope.sourceX)).toEqual([]);
    await expect(queries.getSource(member, scope.sourceX)).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND" });
    await expect(queries.getDocument(member, scope.documentId)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });

    const archivedSources = await queries.listSources(member, scope.workspaceX, { includeArchived: true });
    expect(archivedSources).toHaveLength(1);
    expect(archivedSources[0]).toMatchObject({ id: scope.sourceX, status: "ARCHIVED" });
    await expect(queries.getSource(member, scope.sourceX, { includeArchived: true })).resolves.toMatchObject({ status: "ARCHIVED" });
    await expect(queries.getDocument(member, scope.documentId, { includeArchived: true })).resolves.toMatchObject({ status: "ARCHIVED" });
  });

  it("gates ancestors behind the source archive by default", async () => {
    const scope = await setupQueryScope();
    const { queries, sources } = queryServices();
    const member = callerFromIdentity(hrMember);
    await sources.archiveSource(member, scope.sourceX);
    expect(await queries.getAncestors(member, scope.documentNodeId)).toEqual([]);
    const chain = await queries.getAncestors(member, scope.documentNodeId, { includeArchived: true });
    expect(chain.map((item) => item.id)).toEqual([scope.folderX, scope.childFolderId]);
  });

  it("still requires workspace access for explicit archived reads", async () => {
    const scope = await setupQueryScope();
    const { queries, hub } = queryServices();
    const outsider = callerFromIdentity(hrOutsider);
    await hub.archiveDocument(callerFromIdentity(hrMember), scope.documentId);
    await expect(queries.getDocument(outsider, scope.documentId, { includeArchived: true })).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    await expect(queries.listSources(outsider, scope.workspaceX, { includeArchived: true })).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    await expect(queries.listRevisions(outsider, scope.documentId, { includeArchived: true })).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
  });

  it("lists archived sources for the browser flow after enumerating authorized workspaces", async () => {
    const scope = await setupQueryScope();
    const { queries, workspaces, sources } = queryServices();
    const member = callerFromIdentity(hrMember);
    await sources.archiveSource(member, scope.sourceX);
    const visible = await workspaces.listWorkspaces(member);
    expect(visible.map((workspace) => workspace.id)).toContain(scope.workspaceX);
    const archived = await queries.listSources(member, scope.workspaceX, { includeArchived: true });
    expect(archived.map((source) => source.id)).toContain(scope.sourceX);
    const tree = await queries.listTree(member, scope.sourceX, { includeArchived: true });
    expect(tree).toHaveLength(3);
  });
});

describe("knowledge query not-found contract", () => {
  it("rejects nonexistent resources with precise codes", async () => {
    const scope = await setupQueryScope();
    const { queries } = queryServices();
    const member = callerFromIdentity(hrMember);
    await expect(queries.getSource(member, uuidv7())).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND" });
    await expect(queries.getDocument(member, uuidv7())).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(queries.getCurrentRevision(member, uuidv7())).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(queries.listRevisions(member, uuidv7())).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(queries.getRevision(member, scope.documentId, 999)).rejects.toMatchObject({ code: "REVISION_NOT_FOUND" });
    await expect(queries.getAncestors(member, uuidv7())).rejects.toMatchObject({ code: "TREE_NODE_NOT_FOUND" });
  });

  it("reads existing revisions by number and returns ancestors root-to-parent", async () => {
    const scope = await setupQueryScope();
    const { queries } = queryServices();
    const member = callerFromIdentity(hrMember);
    await expect(queries.getRevision(member, scope.documentId, 1)).resolves.toMatchObject({ revisionNo: 1, markdown: "secret body" });
    await expect(queries.getRevision(member, scope.documentId, 2)).resolves.toMatchObject({ revisionNo: 2, markdown: "secret body v2" });
    await expect(queries.listRevisions(member, scope.documentId)).resolves.toHaveLength(2);
    const ancestors = await queries.getAncestors(member, scope.documentNodeId);
    expect(ancestors.map((item) => item.id)).toEqual([scope.folderX, scope.childFolderId]);
    expect(ancestors[0]).toMatchObject({ type: "folder", label: "Shared Folder" });
    expect(ancestors[1]).toMatchObject({ type: "folder", label: "Child Folder" });
  });

  it("reports archived-hidden and explicit archived reads separately", async () => {
    const scope = await setupQueryScope();
    const { queries, hub } = queryServices();
    const member = callerFromIdentity(hrMember);
    await hub.archiveDocument(member, scope.documentId);
    await expect(queries.getRevision(member, scope.documentId, 1)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(queries.getAncestors(member, scope.documentNodeId)).rejects.toMatchObject({ code: "TREE_NODE_NOT_FOUND" });
    await expect(queries.getRevision(member, scope.documentId, 1, { includeArchived: true })).resolves.toMatchObject({ revisionNo: 1 });
    const ancestors = await queries.getAncestors(member, scope.documentNodeId, { includeArchived: true });
    expect(ancestors.map((item) => item.id)).toEqual([scope.folderX, scope.childFolderId]);
  });
});
