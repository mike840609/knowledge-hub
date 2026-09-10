import { describe, expect, expectTypeOf, it } from "vitest";
import type { CallerContext } from "@/modules/identity/application/caller-context";
import { callerFromIdentity } from "@/modules/identity/application/caller-context";

export type WorkspaceView = {
  id: string;
  name: string;
};

export interface WorkspaceQueryService {
  listWorkspaces(caller: CallerContext): Promise<WorkspaceView[]>;
}

export type RevisionContentInput = {
  title: string;
  markdown: string;
  metadata: Record<string, unknown>;
};

export type CreateHubDocumentInput = RevisionContentInput & {
  sourceId: string;
  parentId: string | null;
  position?: number;
};

export type CreateRevisionInput = RevisionContentInput & {
  documentId: string;
  expectedCurrentRevisionId: string;
};

export type MoveTreeNodeInput = {
  nodeId: string;
  newParentId: string | null;
  newPosition: number;
};

export type SourceView = {
  id: string;
  workspaceId: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  ownership: "SOURCE_MANAGED" | "HUB_MANAGED";
};

export type KnowledgeTreeItem =
  | {
      type: "folder";
      id: string;
      parentId: string | null;
      label: string;
      position: number;
      status: "ACTIVE" | "ARCHIVED";
    }
  | {
      type: "document";
      id: string;
      parentId: string | null;
      documentId: string;
      label: string;
      currentRevisionId: string;
      position: number;
      status: "ACTIVE" | "ARCHIVED";
    };

export type KnowledgeRevisionView = {
  id: string;
  documentId: string;
  revisionNo: number;
  title: string;
  markdown: string;
  metadata: Record<string, unknown>;
  contentHash: string;
  createdBy: string;
  createdAt: Date;
};

export interface HubKnowledgeCommandService {
  createDocument(caller: CallerContext, input: CreateHubDocumentInput): Promise<{ documentId: string; revisionId: string; treeNodeId: string }>;
  createRevision(caller: CallerContext, input: CreateRevisionInput): Promise<{ revisionId: string; revisionNo: number; changed: boolean }>;
  renameFolder(caller: CallerContext, input: { nodeId: string; name: string }): Promise<void>;
  createFolder(caller: CallerContext, input: { sourceId: string; parentId: string | null; name: string; position?: number }): Promise<{ treeNodeId: string }>;
  moveTreeNode(caller: CallerContext, input: MoveTreeNodeInput): Promise<void>;
  reorderTreeNode(caller: CallerContext, input: { nodeId: string; newPosition: number }): Promise<void>;
  archiveDocument(caller: CallerContext, documentId: string): Promise<void>;
  restoreDocument(caller: CallerContext, documentId: string): Promise<void>;
  archiveFolder(caller: CallerContext, treeNodeId: string): Promise<void>;
  restoreFolder(caller: CallerContext, treeNodeId: string): Promise<void>;
}

export type SourceMappingInput = {
  sourceEntryId: string;
  externalId: string | null;
  sourcePath: string;
};

export interface SourceKnowledgeProjectionService {
  projectDocument(caller: CallerContext, input: CreateHubDocumentInput & { mapping: SourceMappingInput }): Promise<{ documentId: string; revisionId: string; treeNodeId: string }>;
  projectRevision(caller: CallerContext, input: CreateRevisionInput): Promise<{ revisionId: string; revisionNo: number; changed: boolean }>;
  projectFolder(caller: CallerContext, input: { sourceId: string; mapping: SourceMappingInput; parentId: string | null; name: string; position?: number }): Promise<{ treeNodeId: string }>;
  renameProjectedFolder(caller: CallerContext, input: { nodeId: string; name: string }): Promise<void>;
  archiveProjectedFolder(caller: CallerContext, nodeId: string): Promise<void>;
  restoreProjectedFolder(caller: CallerContext, nodeId: string): Promise<void>;
  moveProjectedNode(caller: CallerContext, input: MoveTreeNodeInput): Promise<void>;
  archiveProjectedDocument(caller: CallerContext, documentId: string): Promise<void>;
  restoreProjectedDocument(caller: CallerContext, documentId: string): Promise<void>;
}

export interface SourceLifecycleCommands {
  archiveSource(caller: CallerContext, sourceId: string): Promise<void>;
  restoreSource(caller: CallerContext, sourceId: string): Promise<void>;
}

export interface KnowledgeQueryService {
  listSources(caller: CallerContext, workspaceId: string, input?: { includeArchived?: boolean }): Promise<SourceView[]>;
  getSource(caller: CallerContext, sourceId: string, input?: { includeArchived?: boolean }): Promise<SourceView>;
  listTree(caller: CallerContext, sourceId: string, input?: { includeArchived?: boolean }): Promise<KnowledgeTreeItem[]>;
  getDocument(caller: CallerContext, documentId: string, input?: { includeArchived?: boolean }): Promise<{ documentId: string; sourceId: string; workspaceId: string; status: "ACTIVE" | "ARCHIVED"; currentRevision: KnowledgeRevisionView }>;
  getCurrentRevision(caller: CallerContext, documentId: string, input?: { includeArchived?: boolean }): Promise<KnowledgeRevisionView>;
  getRevision(caller: CallerContext, documentId: string, revisionNo: number, input?: { includeArchived?: boolean }): Promise<KnowledgeRevisionView>;
  listRevisions(caller: CallerContext, documentId: string, input?: { includeArchived?: boolean }): Promise<KnowledgeRevisionView[]>;
  getAncestors(caller: CallerContext, nodeId: string, input?: { includeArchived?: boolean }): Promise<KnowledgeTreeItem[]>;
}

type ForbiddenCallerKeys = "caller" | "callerContext" | "identity" | "actorId" | "userId";

function assertNoSmuggledCaller<T extends object>(
  witness: [Extract<keyof T, ForbiddenCallerKeys>] extends [never] ? true : never,
): void {
  expect(witness).toBe(true);
}

function assertCallerFirst<T extends (caller: CallerContext, ...args: never[]) => unknown>(
  witness: [Parameters<T>[0]] extends [CallerContext] ? ([CallerContext] extends [Parameters<T>[0]] ? true : never) : never,
): void {
  expect(witness).toBe(true);
}

const caller = callerFromIdentity({ id: "u", emp_id: "e", name: "N", org_code: "O" });

describe("Phase 1 shared service contracts", () => {
  it("requires CallerContext as the distinct first argument of every Hub command", () => {
    assertCallerFirst<HubKnowledgeCommandService["createDocument"]>(true);
    assertCallerFirst<HubKnowledgeCommandService["createRevision"]>(true);
    assertCallerFirst<HubKnowledgeCommandService["renameFolder"]>(true);
    assertCallerFirst<HubKnowledgeCommandService["createFolder"]>(true);
    assertCallerFirst<HubKnowledgeCommandService["moveTreeNode"]>(true);
    assertCallerFirst<HubKnowledgeCommandService["reorderTreeNode"]>(true);
    assertCallerFirst<HubKnowledgeCommandService["archiveDocument"]>(true);
    assertCallerFirst<HubKnowledgeCommandService["restoreDocument"]>(true);
    assertCallerFirst<HubKnowledgeCommandService["archiveFolder"]>(true);
    assertCallerFirst<HubKnowledgeCommandService["restoreFolder"]>(true);
    assertNoSmuggledCaller<CreateHubDocumentInput>(true);
    assertNoSmuggledCaller<CreateRevisionInput>(true);
    assertNoSmuggledCaller<MoveTreeNodeInput>(true);
    expectTypeOf<CallerContext>().not.toExtend<CreateHubDocumentInput>();
    expectTypeOf<CallerContext>().not.toExtend<CreateRevisionInput>();
    expectTypeOf<CallerContext>().not.toExtend<MoveTreeNodeInput>();
  });

  it("requires CallerContext as the distinct first argument of every projection command", () => {
    assertCallerFirst<SourceKnowledgeProjectionService["projectDocument"]>(true);
    assertCallerFirst<SourceKnowledgeProjectionService["projectRevision"]>(true);
    assertCallerFirst<SourceKnowledgeProjectionService["projectFolder"]>(true);
    assertCallerFirst<SourceKnowledgeProjectionService["renameProjectedFolder"]>(true);
    assertCallerFirst<SourceKnowledgeProjectionService["archiveProjectedFolder"]>(true);
    assertCallerFirst<SourceKnowledgeProjectionService["restoreProjectedFolder"]>(true);
    assertCallerFirst<SourceKnowledgeProjectionService["moveProjectedNode"]>(true);
    assertCallerFirst<SourceKnowledgeProjectionService["archiveProjectedDocument"]>(true);
    assertCallerFirst<SourceKnowledgeProjectionService["restoreProjectedDocument"]>(true);
    assertCallerFirst<SourceLifecycleCommands["archiveSource"]>(true);
    assertCallerFirst<SourceLifecycleCommands["restoreSource"]>(true);
    assertNoSmuggledCaller<SourceMappingInput>(true);
    expectTypeOf<CallerContext>().not.toExtend<SourceMappingInput>();
  });

  it("requires CallerContext as the distinct first argument of every query", () => {
    assertCallerFirst<WorkspaceQueryService["listWorkspaces"]>(true);
    assertCallerFirst<KnowledgeQueryService["listSources"]>(true);
    assertCallerFirst<KnowledgeQueryService["getSource"]>(true);
    assertCallerFirst<KnowledgeQueryService["listTree"]>(true);
    assertCallerFirst<KnowledgeQueryService["getDocument"]>(true);
    assertCallerFirst<KnowledgeQueryService["getCurrentRevision"]>(true);
    assertCallerFirst<KnowledgeQueryService["getRevision"]>(true);
    assertCallerFirst<KnowledgeQueryService["listRevisions"]>(true);
    assertCallerFirst<KnowledgeQueryService["getAncestors"]>(true);
  });

  it("accepts typed stubs for the Hub command surface without service implementations", async () => {
    const seen: { caller: CallerContext; input: unknown }[] = [];
    const stub: HubKnowledgeCommandService = {
      createDocument: async (receivedCaller, input) => {
        seen.push({ caller: receivedCaller, input });
        return { documentId: "d", revisionId: "r", treeNodeId: "n" };
      },
      createRevision: async (receivedCaller, input) => {
        seen.push({ caller: receivedCaller, input });
        return { revisionId: "r2", revisionNo: 2, changed: true };
      },
      renameFolder: async (receivedCaller, input) => {
        seen.push({ caller: receivedCaller, input });
      },
      createFolder: async (receivedCaller, input) => {
        seen.push({ caller: receivedCaller, input });
        return { treeNodeId: "f" };
      },
      moveTreeNode: async (receivedCaller, input) => {
        seen.push({ caller: receivedCaller, input });
      },
      reorderTreeNode: async (receivedCaller, input) => {
        seen.push({ caller: receivedCaller, input });
      },
      archiveDocument: async (receivedCaller, documentId) => {
        seen.push({ caller: receivedCaller, input: documentId });
      },
      restoreDocument: async (receivedCaller, documentId) => {
        seen.push({ caller: receivedCaller, input: documentId });
      },
      archiveFolder: async (receivedCaller, treeNodeId) => {
        seen.push({ caller: receivedCaller, input: treeNodeId });
      },
      restoreFolder: async (receivedCaller, treeNodeId) => {
        seen.push({ caller: receivedCaller, input: treeNodeId });
      },
    };
    const content: RevisionContentInput = { title: "t", markdown: "m", metadata: {} };
    await expect(stub.createDocument(caller, { ...content, sourceId: "s", parentId: null })).resolves.toEqual({ documentId: "d", revisionId: "r", treeNodeId: "n" });
    await expect(stub.createRevision(caller, { ...content, documentId: "d", expectedCurrentRevisionId: "r" })).resolves.toEqual({ revisionId: "r2", revisionNo: 2, changed: true });
    await stub.moveTreeNode(caller, { nodeId: "n", newParentId: null, newPosition: 0 });
    expect(seen).toHaveLength(3);
    expect(seen[0]?.caller).toBe(caller);
    expect(seen[0]?.input).toEqual({ ...content, sourceId: "s", parentId: null });
  });

  it("accepts typed stubs for projection, lifecycle, and query surfaces without service implementations", async () => {
    const projection: SourceKnowledgeProjectionService = {
      projectDocument: async () => ({ documentId: "d", revisionId: "r", treeNodeId: "n" }),
      projectRevision: async () => ({ revisionId: "r2", revisionNo: 2, changed: false }),
      projectFolder: async () => ({ treeNodeId: "f" }),
      renameProjectedFolder: async () => undefined,
      archiveProjectedFolder: async () => undefined,
      restoreProjectedFolder: async () => undefined,
      moveProjectedNode: async () => undefined,
      archiveProjectedDocument: async () => undefined,
      restoreProjectedDocument: async () => undefined,
    };
    const lifecycle: SourceLifecycleCommands = {
      archiveSource: async () => undefined,
      restoreSource: async () => undefined,
    };
    const queries: KnowledgeQueryService = {
      listSources: async () => [{ id: "s", workspaceId: "w", name: "Source", status: "ACTIVE", ownership: "HUB_MANAGED" }],
      getSource: async () => ({ id: "s", workspaceId: "w", name: "Source", status: "ACTIVE", ownership: "HUB_MANAGED" }),
      listTree: async () => [{ type: "folder", id: "f", parentId: null, label: "Folder", position: 0, status: "ACTIVE" }],
      getDocument: async () => ({
        documentId: "d",
        sourceId: "s",
        workspaceId: "w",
        status: "ACTIVE",
        currentRevision: { id: "r", documentId: "d", revisionNo: 1, title: "t", markdown: "m", metadata: {}, contentHash: "h", createdBy: "u", createdAt: new Date(0) },
      }),
      getCurrentRevision: async () => ({ id: "r", documentId: "d", revisionNo: 1, title: "t", markdown: "m", metadata: {}, contentHash: "h", createdBy: "u", createdAt: new Date(0) }),
      getRevision: async () => ({ id: "r", documentId: "d", revisionNo: 1, title: "t", markdown: "m", metadata: {}, contentHash: "h", createdBy: "u", createdAt: new Date(0) }),
      listRevisions: async () => [],
      getAncestors: async () => [],
    };
    const workspaces: WorkspaceQueryService = { listWorkspaces: async () => [{ id: "w", name: "Workspace" }] };
    const content: RevisionContentInput = { title: "t", markdown: "m", metadata: {} };
    await expect(projection.projectDocument(caller, { ...content, sourceId: "s", parentId: null, mapping: { sourceEntryId: "e", externalId: null, sourcePath: "docs/a.md" } })).resolves.toEqual({
      documentId: "d",
      revisionId: "r",
      treeNodeId: "n",
    });
    await lifecycle.archiveSource(caller, "s");
    await expect(queries.listSources(caller, "w")).resolves.toHaveLength(1);
    await expect(queries.getAncestors(caller, "f")).resolves.toEqual([]);
    await expect(workspaces.listWorkspaces(caller)).resolves.toEqual([{ id: "w", name: "Workspace" }]);
  });
});
