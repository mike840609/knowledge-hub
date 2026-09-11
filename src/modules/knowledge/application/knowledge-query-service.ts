import type { CallerContext } from "@/modules/identity/domain/caller-context";
import {
  DocumentNotFoundError,
  IntegrityViolationError,
  RevisionNotFoundError,
  SourceNotFoundError,
  TreeNodeNotFoundError,
} from "../domain/errors";
import type { KnowledgeRevision } from "../domain/revision";
import type { SourcePolicy } from "../domain/source-policy";
import { collectAncestors } from "../domain/tree-rules";
import type { TreeViewNode } from "../ports/tree-repository";
import type { KnowledgeRepositories, KnowledgeUnitOfWork } from "../ports/unit-of-work";

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

function toRevisionView(revision: KnowledgeRevision): KnowledgeRevisionView {
  return {
    id: revision.id,
    documentId: revision.documentId,
    revisionNo: revision.revisionNo,
    title: revision.title,
    markdown: revision.markdown,
    metadata: { ...revision.metadata },
    contentHash: revision.contentHash,
    createdBy: revision.createdBy,
    createdAt: revision.createdAt,
  };
}

function toSourceView(policy: SourcePolicy): SourceView {
  return {
    id: policy.id,
    workspaceId: policy.workspaceId,
    name: policy.name,
    status: policy.status,
    ownership: policy.ownership,
  };
}

function toTreeItem(node: TreeViewNode, includeArchived: boolean): KnowledgeTreeItem | null {
  if (!includeArchived && node.status !== "ACTIVE") return null;
  if (node.nodeType === "FOLDER") {
    if (node.name === null) throw new IntegrityViolationError("A folder tree node is missing its name.");
    return { type: "folder", id: node.id, parentId: node.parentId, label: node.name, position: node.position, status: node.status };
  }
  if (!includeArchived && node.documentStatus !== "ACTIVE") return null;
  if (!node.documentId || node.title === null || node.currentRevisionId === null) {
    throw new IntegrityViolationError("A document tree node is missing its current revision.");
  }
  return {
    type: "document",
    id: node.id,
    parentId: node.parentId,
    documentId: node.documentId,
    label: node.title,
    currentRevisionId: node.currentRevisionId,
    position: node.position,
    status: node.status,
  };
}

async function requireSourcePolicy(repositories: KnowledgeRepositories, sourceId: string): Promise<SourcePolicy> {
  const policy = await repositories.sourcePolicy.findById(sourceId);
  if (!policy) throw new SourceNotFoundError();
  return policy;
}

export class KnowledgeQueryServiceImpl implements KnowledgeQueryService {
  private readonly unitOfWork: KnowledgeUnitOfWork;

  constructor(unitOfWork: KnowledgeUnitOfWork) {
    this.unitOfWork = unitOfWork;
  }

  async listSources(caller: CallerContext, workspaceId: string, input: { includeArchived?: boolean } = {}): Promise<SourceView[]> {
    return this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      await repositories.workspaceAccess.requireMembership(caller, workspaceId);
      const policies = await repositories.sourcePolicy.listByWorkspaceId(workspaceId, input);
      return policies.map(toSourceView);
    });
  }

  async getSource(caller: CallerContext, sourceId: string, input: { includeArchived?: boolean } = {}): Promise<SourceView> {
    return this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      const policy = await requireSourcePolicy(repositories, sourceId);
      await repositories.workspaceAccess.requireMembership(caller, policy.workspaceId);
      if (!input.includeArchived && policy.status !== "ACTIVE") throw new SourceNotFoundError();
      return toSourceView(policy);
    });
  }

  async listTree(caller: CallerContext, sourceId: string, input: { includeArchived?: boolean } = {}): Promise<KnowledgeTreeItem[]> {
    const includeArchived = input.includeArchived ?? false;
    return this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      const policy = await requireSourcePolicy(repositories, sourceId);
      await repositories.workspaceAccess.requireMembership(caller, policy.workspaceId);
      if (!includeArchived && policy.status !== "ACTIVE") return [];
      const nodes = await repositories.tree.listBySource(sourceId);
      return nodes.flatMap((node) => {
        const item = toTreeItem(node, includeArchived);
        return item ? [item] : [];
      });
    });
  }

  async getDocument(
    caller: CallerContext,
    documentId: string,
    input: { includeArchived?: boolean } = {},
  ): Promise<{ documentId: string; sourceId: string; workspaceId: string; status: "ACTIVE" | "ARCHIVED"; currentRevision: KnowledgeRevisionView }> {
    return this.unitOfWork.run(async (repositories) => {
      const { document, policy } = await this.requireVisibleDocument(repositories, caller, documentId, input.includeArchived ?? false);
      const current = await repositories.revisions.findCurrent(document.id);
      if (!current) throw new IntegrityViolationError("Document current revision is missing.");
      return {
        documentId: document.id,
        sourceId: document.sourceId,
        workspaceId: policy.workspaceId,
        status: document.status,
        currentRevision: toRevisionView(current),
      };
    });
  }

  async getCurrentRevision(caller: CallerContext, documentId: string, input: { includeArchived?: boolean } = {}): Promise<KnowledgeRevisionView> {
    return this.unitOfWork.run(async (repositories) => {
      const { document } = await this.requireVisibleDocument(repositories, caller, documentId, input.includeArchived ?? false);
      const current = await repositories.revisions.findCurrent(document.id);
      if (!current) throw new IntegrityViolationError("Document current revision is missing.");
      return toRevisionView(current);
    });
  }

  async getRevision(caller: CallerContext, documentId: string, revisionNo: number, input: { includeArchived?: boolean } = {}): Promise<KnowledgeRevisionView> {
    return this.unitOfWork.run(async (repositories) => {
      const { document } = await this.requireVisibleDocument(repositories, caller, documentId, input.includeArchived ?? false);
      const revision = await repositories.revisions.findByRevisionNo(document.id, revisionNo);
      if (!revision) throw new RevisionNotFoundError();
      return toRevisionView(revision);
    });
  }

  async listRevisions(caller: CallerContext, documentId: string, input: { includeArchived?: boolean } = {}): Promise<KnowledgeRevisionView[]> {
    return this.unitOfWork.run(async (repositories) => {
      const { document } = await this.requireVisibleDocument(repositories, caller, documentId, input.includeArchived ?? false);
      const revisions = await repositories.revisions.listByDocument(document.id);
      return revisions.map(toRevisionView);
    });
  }

  async getAncestors(caller: CallerContext, nodeId: string, input: { includeArchived?: boolean } = {}): Promise<KnowledgeTreeItem[]> {
    const includeArchived = input.includeArchived ?? false;
    return this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      const node = await repositories.tree.findById(nodeId);
      if (!node) throw new TreeNodeNotFoundError();
      const policy = await requireSourcePolicy(repositories, node.sourceId);
      await repositories.workspaceAccess.requireMembership(caller, policy.workspaceId);
      if (!includeArchived && policy.status !== "ACTIVE") return [];
      if (!includeArchived && node.status !== "ACTIVE") throw new TreeNodeNotFoundError();
      const chain = collectAncestors(await repositories.tree.listBySource(node.sourceId), nodeId);
      return chain.flatMap((ancestor) => {
        const item = toTreeItem(ancestor, includeArchived);
        return item ? [item] : [];
      });
    });
  }

  private async requireVisibleDocument(
    repositories: KnowledgeRepositories,
    caller: CallerContext,
    documentId: string,
    includeArchived: boolean,
  ): Promise<{ document: { id: string; sourceId: string; status: "ACTIVE" | "ARCHIVED" }; policy: SourcePolicy }> {
    await repositories.users.upsertIdentity(caller.identity);
    const document = await repositories.documents.findById(documentId);
    if (!document) throw new DocumentNotFoundError();
    const policy = await requireSourcePolicy(repositories, document.sourceId);
    await repositories.workspaceAccess.requireMembership(caller, policy.workspaceId);
    if (!includeArchived && (document.status !== "ACTIVE" || policy.status !== "ACTIVE")) throw new DocumentNotFoundError();
    return { document, policy };
  }
}
