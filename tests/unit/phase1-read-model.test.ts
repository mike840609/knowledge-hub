import { describe, expect, it } from "vitest";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { KnowledgeQueryServiceImpl } from "@/modules/knowledge/application/knowledge-query-service";
import type { KnowledgeRepositories, KnowledgeUnitOfWork } from "@/modules/knowledge/ports/unit-of-work";
import type { TreeViewNode } from "@/modules/knowledge/ports/tree-repository";

const reader: UserIdentity = { id: "u-reader", emp_id: "READER", name: "Reader", org_code: "RD" };
const caller = callerFromIdentity(reader);

const sourceRow = {
  id: "source-1",
  workspaceId: "workspace-1",
  name: "Hub Source",
  sourceType: "HUB",
  ownership: "HUB_MANAGED",
  status: "ACTIVE",
  syncVersion: 0,
} as const;

const revisionOne = {
  id: "revision-1",
  documentId: "document-1",
  revisionNo: 1,
  title: "First Title",
  markdown: "body",
  metadata: {},
  contentHash: "h1",
  createdBy: reader.id,
  createdAt: new Date("2026-09-01T00:00:00Z"),
};

const revisionTwo = { ...revisionOne, id: "revision-2", revisionNo: 2, title: "Second Title", contentHash: "h2" };

const folderNode: TreeViewNode = {
  id: "node-folder",
  sourceId: sourceRow.id,
  parentId: null,
  nodeType: "FOLDER",
  name: "Runbooks",
  documentId: null,
  position: 0,
  status: "ACTIVE",
  updatedBy: reader.id,
  archivedBy: null,
  archivedAt: null,
  title: null,
  documentStatus: null,
  currentRevisionId: null,
};

const documentNode: TreeViewNode = {
  id: "node-document",
  sourceId: sourceRow.id,
  parentId: folderNode.id,
  nodeType: "DOCUMENT",
  name: null,
  documentId: revisionOne.documentId,
  position: 0,
  status: "ACTIVE",
  updatedBy: reader.id,
  archivedBy: null,
  archivedAt: null,
  title: revisionOne.title,
  documentStatus: "ACTIVE",
  currentRevisionId: revisionOne.id,
};

type FakeOptions = {
  revisions?: typeof revisionOne[];
  nodes?: TreeViewNode[];
  member?: boolean;
};

function fakeUnitOfWork(options: FakeOptions = {}): KnowledgeUnitOfWork {
  const revisions = options.revisions ?? [revisionOne];
  const current = revisions.at(-1) ?? revisionOne;
  const liveDocumentNode: TreeViewNode = { ...documentNode, title: current.title, currentRevisionId: current.id };
  const nodes = options.nodes ?? [folderNode, liveDocumentNode];
  const member = options.member ?? true;
  const repositories = {
    users: { upsertIdentity: async () => undefined },
    documents: {
      findById: async (id: string) => (id === "document-1"
        ? { id: "document-1", sourceId: sourceRow.id, currentRevisionId: revisions.at(-1)?.id ?? null, status: "ACTIVE" as const }
        : null),
    },
    revisions: {
      findCurrent: async () => revisions.at(-1) ?? null,
      findById: async (id: string) => revisions.find((revision) => revision.id === id) ?? null,
      findByRevisionNo: async (documentId: string, revisionNo: number) => revisions.find((revision) => revision.documentId === documentId && revision.revisionNo === revisionNo) ?? null,
      listByDocument: async () => [...revisions],
    },
    tree: {
      findById: async (id: string) => nodes.find((node) => node.id === id) ?? null,
      listBySource: async () => [...nodes],
    },
    sourcePolicy: {
      findById: async (id: string) => (id === sourceRow.id ? { ...sourceRow } : null),
      lockById: async (id: string) => (id === sourceRow.id ? { ...sourceRow } : null),
      listByWorkspaceId: async (workspaceId: string, listOptions: { includeArchived?: boolean } = {}) => {
        if (workspaceId !== sourceRow.workspaceId) return [];
        if (!listOptions.includeArchived && sourceRow.status !== "ACTIVE") return [];
        return [{ ...sourceRow }];
      },
    },
    workspaceAccess: {
      requireMembership: async (receivedCaller: typeof caller, workspaceId: string) => {
        if (receivedCaller !== caller || !member || workspaceId !== sourceRow.workspaceId) {
          const { WorkspaceAccessDeniedError } = await import("@/modules/workspaces/domain/errors");
          throw new WorkspaceAccessDeniedError();
        }
      },
    },
    linkedEntries: {},
  } as unknown as KnowledgeRepositories;
  return { run: async (work) => work(repositories) };
}

describe("knowledge read models", () => {
  it("labels a folder from TreeNode.name", async () => {
    const queries = new KnowledgeQueryServiceImpl(fakeUnitOfWork());
    const tree = await queries.listTree(caller, sourceRow.id);
    expect(tree).toContainEqual({ type: "folder", id: folderNode.id, parentId: null, label: "Runbooks", position: 0, status: "ACTIVE" });
  });

  it("labels a document from its current revision title with a single title truth", async () => {
    const queries = new KnowledgeQueryServiceImpl(fakeUnitOfWork({ revisions: [revisionOne, revisionTwo] }));
    const tree = await queries.listTree(caller, sourceRow.id);
    const item = tree.find((entry) => entry.type === "document");
    expect(item).toMatchObject({ documentId: "document-1", label: "Second Title", currentRevisionId: "revision-2" });
    const view = await queries.getDocument(caller, "document-1");
    expect(view.currentRevision.title).toBe("Second Title");
    expect(view.currentRevision.id).toBe("revision-2");
  });

  it("serves a non-Web caller from a trusted CallerContext without a web runtime", async () => {
    const agentIdentity: UserIdentity = { id: "u-agent", emp_id: "AGENT-01", name: "Agent", org_code: "AGENT" };
    const agentCaller = callerFromIdentity(agentIdentity);
    const repositories = {
      users: { upsertIdentity: async () => undefined },
      documents: {
        findById: async () => ({ id: "document-1", sourceId: sourceRow.id, currentRevisionId: revisionOne.id, status: "ACTIVE" as const }),
      },
      revisions: {
        findCurrent: async () => revisionOne,
        findByRevisionNo: async () => revisionOne,
        listByDocument: async () => [revisionOne],
      },
      tree: { findById: async () => documentNode, listBySource: async () => [folderNode, documentNode] },
      sourcePolicy: {
        findById: async () => ({ ...sourceRow }),
        listByWorkspaceId: async () => [{ ...sourceRow }],
      },
      workspaceAccess: { requireMembership: async () => undefined },
      linkedEntries: {},
    } as unknown as KnowledgeRepositories;
    const queries = new KnowledgeQueryServiceImpl({ run: async (work) => work(repositories) });
    await expect(queries.getDocument(agentCaller, "document-1")).resolves.toMatchObject({ documentId: "document-1", workspaceId: sourceRow.workspaceId });
    await expect(queries.listSources(agentCaller, sourceRow.workspaceId)).resolves.toHaveLength(1);
  });

  it("rejects an unauthorized workspace scope without leaking sources", async () => {
    const queries = new KnowledgeQueryServiceImpl(fakeUnitOfWork({ member: false }));
    await expect(queries.listSources(caller, sourceRow.workspaceId)).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
  });
});
