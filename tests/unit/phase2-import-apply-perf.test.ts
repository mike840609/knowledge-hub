import { describe, expect, it } from "vitest";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { KnowledgeDocument } from "@/modules/knowledge/domain/document";
import type { KnowledgeRevision } from "@/modules/knowledge/domain/revision";
import type { KnowledgeTreeNode } from "@/modules/knowledge/domain/tree-node";
import type { TreeViewNode } from "@/modules/knowledge/ports/tree-repository";
import type { SourceEntry } from "@/modules/sources/domain/source-entry";
import type { FolderImportPlan } from "@/modules/sources/domain/import-plan";
import type { KnowledgeSource } from "@/modules/sources/domain/source";
import type { SourcePolicy } from "@/modules/knowledge/domain/source-policy";
import { executeFolderImportPlan } from "@/modules/sources/application/source-import-plan-executor";
import { bindSourceProjection } from "@/modules/sources/application/source-knowledge-projection-service";
import type { SourceRepositories } from "@/modules/sources/ports/unit-of-work";

const DOC_COUNT = 50;

function buildPlan(sourceId: string, workspaceId: string): FolderImportPlan {
  return {
    planVersion: "phase2:v2",
    sourceBinding: { workspaceId, sourceId, basedOnVersion: 1 },
    folders: { create: [], restore: [], archive: [] },
    documents: {
      create: Array.from({ length: DOC_COUNT }, (_, i) => ({
        sourcePath: `doc-${i}.md`,
        parentPath: null,
        desiredPosition: i,
        externalId: null,
        content: { title: `Doc ${i}`, markdown: `# Doc ${i}\n`, metadata: {}, contentHash: `hash-${i}` },
      })),
      restore: [],
      move: [],
      revise: [],
      archive: [],
      updateLocator: [],
      adoptExternalId: [],
    },
    assets: { upsert: [], remove: [] },
    ordering: Array.from({ length: DOC_COUNT }, (_, i) => ({
      nodeKey: `document:doc-${i}.md`,
      parentPath: null,
      position: i,
    })),
    preview: [],
    summary: {
      documents: { added: DOC_COUNT, updated: 0, moved: 0, renamed: 0, archived: 0, restored: 0, unchanged: 0 },
      folders: { added: 0, archived: 0, restored: 0 },
      assets: { added: 0, updated: 0, removed: 0, unchanged: 0 },
      warnings: 0,
      blockers: 0,
      affectedDocuments: DOC_COUNT,
      changed: true,
    },
  };
}

/** In-memory counting stub: emulates the tx-local tree/document/entry state. */
function stubRepositories(source: KnowledgeSource) {
  const counts = { listBySource: 0, upsertIdentity: 0, sourcePolicyLockById: 0, workspaceLockById: 0 };
  const nodes = new Map<string, TreeViewNode>();
  const documents = new Map<string, KnowledgeDocument>();
  const revisions = new Map<string, KnowledgeRevision>();
  const entries = new Map<string, SourceEntry>();

  const repositories = {
    users: {
      upsertIdentity: async () => {
        counts.upsertIdentity += 1;
      },
    },
    sourcePolicy: {
      lockById: async (id: string) => {
        counts.sourcePolicyLockById += 1;
        if (id !== source.id) return null;
        return {
          id: source.id,
          workspaceId: source.workspaceId,
          name: source.name,
          sourceType: source.sourceType,
          ownership: source.ownership,
          status: source.status,
          syncVersion: source.syncVersion,
        };
      },
    },
    workspaces: {
      lockById: async (id: string) => {
        counts.workspaceLockById += 1;
        if (id !== source.workspaceId) return null;
        return { id, name: "ws", workspaceType: "TEAM", lifecycleState: "ACTIVE" };
      },
    },
    workspaceAccess: {
      requireMembership: async () => undefined,
    },
    workspaceMemberships: {
      find: async () => ({ workspaceId: source.workspaceId, userId: "user-1", role: "OWNER" as const }),
    },
    groupMappings: {
      listByWorkspace: async () => [],
    },
    tree: {
      insert: async (node: KnowledgeTreeNode) => {
        nodes.set(node.id, { ...node, title: null, documentStatus: "ACTIVE", currentRevisionId: null });
      },
      findById: async (id: string) => nodes.get(id) ?? null,
      lockById: async (id: string) => nodes.get(id) ?? null,
      listBySource: async (sourceId: string) => {
        counts.listBySource += 1;
        return [...nodes.values()].filter((node) => node.sourceId === sourceId);
      },
      updateParent: async (nodeId: string, parentId: string | null) => {
        nodes.get(nodeId)!.parentId = parentId;
      },
      updateName: async (nodeId: string, name: string) => {
        nodes.get(nodeId)!.name = name;
      },
      updatePosition: async (nodeId: string, position: number) => {
        nodes.get(nodeId)!.position = position;
      },
      updateStatus: async (nodeId: string, status: "ACTIVE" | "ARCHIVED") => {
        nodes.get(nodeId)!.status = status;
      },
      updateStatusForDocument: async (documentId: string, status: "ACTIVE" | "ARCHIVED") => {
        for (const node of nodes.values()) if (node.documentId === documentId) node.status = status;
      },
      hasDescendant: async () => false,
    },
    documents: {
      insertDraft: async (document: KnowledgeDocument) => {
        documents.set(document.id, { ...document });
      },
      findById: async (id: string) => documents.get(id) ?? null,
      lockById: async (id: string) => documents.get(id) ?? null,
      setCurrentRevision: async (documentId: string, revisionId: string) => {
        documents.get(documentId)!.currentRevisionId = revisionId;
      },
      assertComplete: async (documentId: string) => {
        if (!documents.get(documentId)?.currentRevisionId) throw new Error("incomplete document");
      },
      updateStatus: async (documentId: string, status: "ACTIVE" | "ARCHIVED") => {
        documents.get(documentId)!.status = status;
      },
    },
    revisions: {
      insert: async (revision: KnowledgeRevision) => {
        revisions.set(revision.id, { ...revision });
      },
      findCurrent: async (documentId: string) => {
        const rows = [...revisions.values()].filter((revision) => revision.documentId === documentId);
        return rows.length === 0 ? null : rows.reduce((a, b) => (a.revisionNo >= b.revisionNo ? a : b));
      },
      nextRevisionNumber: async (documentId: string) =>
        [...revisions.values()].filter((revision) => revision.documentId === documentId).length + 1,
    },
    entries: {
      findById: async (entryId: string) => entries.get(entryId) ?? null,
      findByExternalId: async () => null,
      findByDocumentId: async (documentId: string) =>
        [...entries.values()].find((entry) => entry.documentId === documentId) ?? null,
      findByTreeNodeId: async (treeNodeId: string) =>
        [...entries.values()].find((entry) => entry.treeNodeId === treeNodeId) ?? null,
      insert: async (entry: SourceEntry) => {
        entries.set(entry.id, { ...entry });
      },
      update: async (entry: SourceEntry) => {
        entries.set(entry.id, { ...entry });
      },
    },
    assets: {
      listBySourceId: async () => [],
    },
    importCanonicalState: {
      load: async () => ({ documents: [], folders: [], assets: [] }),
    },
  } as unknown as SourceRepositories;
  return { repositories, counts, nodes, entries };
}

describe("executeFolderImportPlan read amplification (issue #9 item 17a)", () => {
  it(`applies a ${DOC_COUNT}-document plan with O(1) tree reads and one binding resolution`, async () => {
    const now = new Date("2026-09-15T00:00:00.000Z");
    const source: KnowledgeSource = {
      id: "src-1",
      name: "source",
      workspaceId: "ws-1",
      sourceType: "FOLDER_SYNC",
      ownership: "SOURCE_MANAGED",
      status: "ACTIVE",
      syncVersion: 1,
      createdBy: "user-1",
      updatedBy: "user-1",
      archivedBy: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const caller = callerFromIdentity({ id: "user-1", emp_id: "E001", name: "Test", org_code: "HRSD" });
    const { repositories, counts, nodes, entries } = stubRepositories(source);

    await executeFolderImportPlan(repositories, caller, source, buildPlan(source.id, source.workspaceId), {
      stagingEntriesByUploadKey: new Map(),
      now: () => now,
    });

    // Functional outcome: every planned document projected with its mapping.
    expect(nodes.size).toBe(DOC_COUNT);
    expect(entries.size).toBe(DOC_COUNT);

    // Perf contract: 1 hoisted tree read (+ documented renumber spillover at most),
    // and exactly one source-binding resolution per Apply.
    expect(counts.listBySource).toBeLessThanOrEqual(2);
    expect(counts.upsertIdentity).toBe(1);
    expect(counts.sourcePolicyLockById).toBe(1);
    expect(counts.workspaceLockById).toBe(1);
  });
});

describe("bindSourceProjection tree-view field sync (issue #9 item 17a follow-up)", () => {
  const now = new Date("2026-09-15T00:00:00.000Z");

  function seedSource() {
    const source: KnowledgeSource = {
      id: "src-view",
      name: "source",
      workspaceId: "ws-1",
      sourceType: "FOLDER_SYNC",
      ownership: "SOURCE_MANAGED",
      status: "ACTIVE",
      syncVersion: 1,
      createdBy: "user-1",
      updatedBy: "user-1",
      archivedBy: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const caller = callerFromIdentity({ id: "user-1", emp_id: "E001", name: "Test", org_code: "HRSD" });
    const boundPolicy: SourcePolicy = {
      id: source.id,
      workspaceId: source.workspaceId,
      name: source.name,
      sourceType: source.sourceType,
      ownership: source.ownership,
      status: source.status,
      syncVersion: source.syncVersion,
    };
    return { source, caller, boundPolicy };
  }

  async function seedDocumentView(
    status: "ACTIVE" | "ARCHIVED",
    currentRevisionId: string,
  ) {
    const { source, caller, boundPolicy } = seedSource();
    const { repositories, nodes } = stubRepositories(source);
    const viewNode: TreeViewNode = {
      id: "node-1",
      sourceId: source.id,
      parentId: null,
      nodeType: "DOCUMENT",
      name: null,
      documentId: "doc-1",
      position: 0,
      status,
      updatedBy: "user-1",
      archivedBy: null,
      archivedAt: null,
      title: "Doc",
      documentStatus: status,
      currentRevisionId,
    };
    nodes.set(viewNode.id, viewNode);
    await repositories.documents.insertDraft({
      id: "doc-1",
      sourceId: source.id,
      currentRevisionId,
      status,
      createdBy: "user-1",
      updatedBy: "user-1",
      archivedBy: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await repositories.revisions.insert({
      id: currentRevisionId,
      documentId: "doc-1",
      revisionNo: 1,
      title: "Doc",
      markdown: "# Doc\n",
      metadata: {},
      contentHash: "hash-1",
      createdBy: "user-1",
      createdAt: now,
    });
    const treeView = [viewNode];
    const projection = bindSourceProjection(
      repositories,
      { id: source.id, workspaceId: source.workspaceId },
      { boundPolicy, treeView },
    );
    return { caller, projection, viewNode };
  }

  it("syncs both view status fields when a projected document is archived", async () => {
    const { caller, projection, viewNode } = await seedDocumentView("ACTIVE", "rev-1");

    await projection.archiveProjectedDocument(caller, "doc-1");

    expect(viewNode.status).toBe("ARCHIVED");
    expect(viewNode.documentStatus).toBe("ARCHIVED");
  });

  it("syncs both view status fields when a projected document is restored", async () => {
    const { caller, projection, viewNode } = await seedDocumentView("ARCHIVED", "rev-1");

    await projection.restoreProjectedDocument(caller, "doc-1");

    expect(viewNode.status).toBe("ACTIVE");
    expect(viewNode.documentStatus).toBe("ACTIVE");
  });

  it("syncs the view currentRevisionId after a projected revision is written", async () => {
    const { caller, projection, viewNode } = await seedDocumentView("ACTIVE", "rev-1");

    const result = await projection.projectRevision(caller, {
      documentId: "doc-1",
      expectedCurrentRevisionId: "rev-1",
      title: "Doc v2",
      markdown: "# Doc v2\n",
      metadata: {},
    });

    expect(result.changed).toBe(true);
    expect(viewNode.currentRevisionId).toBe(result.revisionId);
  });
});
