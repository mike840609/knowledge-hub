import { describe, expect, it, vi } from "vitest";
import { DocumentShareService } from "@/modules/knowledge/application/document-share-service";
import type { DocumentShareLink } from "@/modules/knowledge/domain/document-share-link";
import type { TreeViewNode } from "@/modules/knowledge/ports/tree-repository";
import type { KnowledgeRepositories } from "@/modules/knowledge/ports/unit-of-work";
import { fixtureIdentity } from "../fixtures/knowledge";

const now = new Date("2026-10-29T00:00:00Z");
const folderId = "0192f3a4-5b6c-7d8e-9f01-000000000001";
const documentId = "0192f3a4-5b6c-7d8e-9f01-000000000002";
const documentNodeId = "0192f3a4-5b6c-7d8e-9f01-000000000003";
const revisionId = "0192f3a4-5b6c-7d8e-9f01-000000000004";
const sourceId = "0192f3a4-5b6c-7d8e-9f01-000000000005";
const workspaceId = "0192f3a4-5b6c-7d8e-9f01-000000000006";
const token = "6f1c2c9e-4c5e-4b8a-9d2e-3a1b2c3d4e5f";

const link: DocumentShareLink = {
  id: "0192f3a4-5b6c-7d8e-9f01-000000000007",
  target: { kind: "FOLDER", folderNodeId: folderId },
  token,
  label: null,
  createdBy: fixtureIdentity.id,
  createdAt: new Date("2026-10-28T00:00:00Z"),
  expiresAt: new Date("2026-11-28T00:00:00Z"),
  revokedBy: null,
  revokedAt: null,
};

function node(overrides: Partial<TreeViewNode> & Pick<TreeViewNode, "id" | "parentId" | "nodeType">): TreeViewNode {
  return {
    sourceId,
    name: null,
    documentId: null,
    position: 0,
    status: "ACTIVE",
    updatedBy: fixtureIdentity.id,
    archivedBy: null,
    archivedAt: null,
    title: null,
    pageIcon: null,
    documentStatus: null,
    currentRevisionId: null,
    ...overrides,
  };
}

const folderNode = node({ id: folderId, parentId: null, nodeType: "FOLDER", name: "Shared" });
const documentNode = node({
  id: documentNodeId,
  parentId: folderId,
  nodeType: "DOCUMENT",
  documentId,
  title: "Note",
  documentStatus: "ACTIVE",
  currentRevisionId: revisionId,
});

function repositories(nodes: readonly TreeViewNode[], markdown: string) {
  const loadCatalog = vi.fn(async () => [{ documentId, sourceId, title: "Note", sourcePath: null, createdAt: now }]);
  const repositories = {
    shareLinks: { findByToken: vi.fn(async () => link) },
    tree: {
      findById: vi.fn(async (id: string) => (id === folderId ? folderNode : null)),
      findByDocumentId: vi.fn(async (id: string) => (id === documentId ? documentNode : null)),
      listChain: vi.fn(async () => [
        { id: documentNodeId, parentId: folderId, nodeType: "DOCUMENT" as const, status: "ACTIVE" as const },
        { id: folderId, parentId: null, nodeType: "FOLDER" as const, status: "ACTIVE" as const },
      ]),
      listSubtree: vi.fn(async () => [...nodes]),
    },
    sourcePolicy: { findById: vi.fn(async () => ({ id: sourceId, workspaceId, status: "ACTIVE" })) },
    workspaces: { findById: vi.fn(async () => ({ id: workspaceId, lifecycleState: "ACTIVE", personalOwnerUserId: fixtureIdentity.id })) },
    workspaceMemberships: { find: vi.fn(async () => ({ role: "OWNER" })) },
    users: { findById: vi.fn(async () => ({ id: fixtureIdentity.id, name: "Owner" })) },
    documents: { findById: vi.fn(async () => ({ id: documentId, sourceId, status: "ACTIVE", pageIcon: null })) },
    revisions: { findCurrent: vi.fn(async () => ({ id: revisionId, title: "Note", markdown, createdAt: now })) },
    links: { loadCatalog },
  };
  return { repositories: repositories as unknown as KnowledgeRepositories, loadCatalog };
}

function service(store: KnowledgeRepositories) {
  return new DocumentShareService({ run: (work) => work(store) }, { issue: () => "unused" }, () => now);
}

describe("a folder link's document read", () => {
  it("does not read the workspace link catalog when the document has no links", async () => {
    const { repositories: store, loadCatalog } = repositories([folderNode, documentNode], "A plain note with no links.");
    const view = await service(store).readShared(token, { documentId, recordView: false });
    expect(view.kind).toBe("FOLDER");
    expect(view.kind === "FOLDER" ? view.document?.links : null).toEqual([]);
    expect(loadCatalog).not.toHaveBeenCalled();
  });

  it("reads a large flat folder without quadratic sibling copying", async () => {
    const count = 50_000;
    const nodes: TreeViewNode[] = [folderNode];
    for (let index = 0; index < count; index += 1) {
      nodes.push(node({
        id: `node-${index}`,
        parentId: folderId,
        nodeType: "DOCUMENT",
        documentId: index === 0 ? documentId : `document-${index}`,
        title: `Note ${index}`,
        documentStatus: "ACTIVE",
        currentRevisionId: `revision-${index}`,
      }));
    }
    const { repositories: store } = repositories(nodes, "A plain note with no links.");
    const started = performance.now();
    const view = await service(store).readShared(token, { documentId, recordView: false });
    const elapsed = performance.now() - started;
    if (view.kind !== "FOLDER") throw new Error(`expected a folder view, got ${view.kind}`);
    expect(view.tree).toHaveLength(count);
    expect(view.tree[0]?.name).toBe("Note 0");
    expect(view.tree.at(-1)?.name).toBe(`Note ${count - 1}`);
    expect(elapsed).toBeLessThan(2_000);
    console.info(JSON.stringify({ flatFolderNodes: count, readMs: Math.round(elapsed) }));
  });
});
