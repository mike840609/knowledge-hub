import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { KnowledgeUnitOfWork } from "../ports/unit-of-work";
import { createDocumentInTransaction, type CreateHubDocumentInput } from "./internal/create-document";
import { createFolderInTransaction } from "./internal/create-folder";
import { createRevisionInTransaction, type CreateRevisionInput } from "./internal/create-revision";
import { moveTreeNodeInTransaction } from "./internal/move-tree-node";
import { renameFolderInTransaction } from "./internal/rename-folder";
import { reorderTreeNodeInTransaction } from "./internal/reorder-tree-node";

export type { CreateHubDocumentInput, CreateRevisionInput };

export type MoveTreeNodeInput = {
  nodeId: string;
  newParentId: string | null;
  newPosition: number;
};

/**
 * Phase 1 shared Hub command contract (plan §3, verbatim). Tasks 4–5 implement
 * document/revision/tree operations; Task 6 adds lifecycle operations on the
 * implementation below.
 */
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

/**
 * Hub commands for HUB_MANAGED content. Every operation runs inside one READ
 * COMMITTED transaction (owned by the injected unit of work) following plan
 * §6: caller → resolve/lock Source on this connection → transaction-scoped
 * WorkspaceAccessPolicy → ACTIVE + ownership checks → locks/validation/writes.
 * Caller identity comes only from the explicit first parameter; command
 * payloads cannot carry caller or workspace authorization evidence, and no
 * force/bypass/isSync escape flag exists.
 */
export class HubKnowledgeCommandServiceImpl implements Omit<HubKnowledgeCommandService, "archiveDocument" | "restoreDocument" | "archiveFolder" | "restoreFolder"> {
  private readonly unitOfWork: KnowledgeUnitOfWork;

  constructor(unitOfWork: KnowledgeUnitOfWork) {
    this.unitOfWork = unitOfWork;
  }

  async createDocument(
    caller: CallerContext,
    input: CreateHubDocumentInput,
  ): Promise<{ documentId: string; revisionId: string; treeNodeId: string }> {
    return this.unitOfWork.run((repositories) => createDocumentInTransaction(repositories, caller, input));
  }

  async createRevision(
    caller: CallerContext,
    input: CreateRevisionInput,
  ): Promise<{ revisionId: string; revisionNo: number; changed: boolean }> {
    return this.unitOfWork.run((repositories) => createRevisionInTransaction(repositories, caller, input));
  }

  async createFolder(
    caller: CallerContext,
    input: { sourceId: string; parentId: string | null; name: string; position?: number },
  ): Promise<{ treeNodeId: string }> {
    return this.unitOfWork.run((repositories) => createFolderInTransaction(repositories, caller, input));
  }

  async renameFolder(caller: CallerContext, input: { nodeId: string; name: string }): Promise<void> {
    return this.unitOfWork.run((repositories) => renameFolderInTransaction(repositories, caller, input));
  }

  async moveTreeNode(caller: CallerContext, input: MoveTreeNodeInput): Promise<void> {
    return this.unitOfWork.run((repositories) => moveTreeNodeInTransaction(repositories, caller, input));
  }

  async reorderTreeNode(caller: CallerContext, input: { nodeId: string; newPosition: number }): Promise<void> {
    return this.unitOfWork.run((repositories) => reorderTreeNodeInTransaction(repositories, caller, input));
  }
}
