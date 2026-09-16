import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { fingerprintRevisionContent } from "@/modules/knowledge/domain/content";
import {
  CrossSourceMoveError,
  DocumentArchivedError,
  DocumentNotFoundError,
  FolderNotEmptyError,
  IntegrityViolationError,
  InvalidParentError,
  InvalidSourceMappingError,
  RevisionConflictError,
  SourceEntryConflictError,
  TreeCycleError,
  TreeNodeNotFoundError,
  ValidationError,
} from "@/modules/knowledge/domain/errors";
import { isRevisionContentUnchanged } from "@/modules/knowledge/domain/revision";
import type { SourcePolicy } from "@/modules/knowledge/domain/source-policy";
import type { KnowledgeTreeNode } from "@/modules/knowledge/domain/tree-node";
import type { TreeViewNode } from "@/modules/knowledge/ports/tree-repository";
import { normalizeFolderName, normalizeTreePosition } from "@/modules/knowledge/domain/tree-rules";
import type {
  CreateHubDocumentInput,
  CreateRevisionInput,
  MoveTreeNodeInput,
} from "@/modules/knowledge/application/hub-knowledge-command-service";
import { assertActiveDocumentPlacement, assertActiveFolderAncestry } from "@/modules/knowledge/application/tree-validation";
import {
  placeNodeAtIndex,
  renumberSiblingPositions,
  requireLockedSourceNode,
  requireSourceManagedSource,
} from "@/modules/knowledge/application/internal/tree-transaction";
import { uuidv7 } from "@/shared/ids/uuidv7";
import type { SourceRepositories } from "../ports/unit-of-work";
import {
  archiveSourceEntry,
  createSourceEntryMapping,
  resolveByExternalId,
  restoreSourceEntry,
} from "./source-entry-mapping-service";

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
  restoreProjectedDocumentToParent(caller: CallerContext, input: { documentId: string; newParentId: string | null; newPosition: number }): Promise<void>;
}

export type BoundProjectionSource = {
  id: string;
  workspaceId: string;
};

/**
 * Optional per-Apply fast path (issue #9 item 17a). When the owning
 * orchestration already resolved the Source binding and hoisted the full
 * source tree on this connection, it passes both here so projection commands
 * skip their per-command `requireBoundSource` round-trip (upsertIdentity +
 * Source FOR UPDATE + Workspace guard) and their per-command full-tree
 * `listBySource` re-reads. Omitting the hints keeps the legacy path
 * byte-identical for non-import callers (2-arg `bindSourceProjection`).
 *
 * `treeView`, when present, is the executor-owned MUTABLE tx-local truth:
 * every tree write a projection command performs (insert/move/updatePosition
 * /renumber/status) maintains it in memory alongside the database write, so
 * later commands never observe a stale row.
 */
export type BoundProjectionHints = {
  boundPolicy?: SourcePolicy;
  treeView?: TreeViewNode[];
};

function requireBoundDocumentSource(existingSourceId: string, bound: BoundProjectionSource): void {
  if (existingSourceId !== bound.id) throw new DocumentNotFoundError();
}

function requireBoundTreeSource(routingSourceId: string | undefined, bound: BoundProjectionSource): string {
  if (!routingSourceId || routingSourceId !== bound.id) throw new TreeNodeNotFoundError();
  return routingSourceId;
}

async function requireBoundSource(
  repositories: SourceRepositories,
  caller: CallerContext,
  bound: BoundProjectionSource,
  hints?: BoundProjectionHints,
): Promise<SourcePolicy> {
  // Hoisted fast path: the binding was already resolved once per Apply on
  // this connection under the Source X-lock. Only the cheap in-memory
  // workspaceId equality check repeats per command (no DB, no new locks).
  if (hints?.boundPolicy) {
    if (hints.boundPolicy.workspaceId !== bound.workspaceId || hints.boundPolicy.id !== bound.id) {
      throw new InvalidSourceMappingError("Bound source workspace changed during projection.");
    }
    return hints.boundPolicy;
  }
  const source = await requireSourceManagedSource(repositories, caller, bound.id);
  if (source.workspaceId !== bound.workspaceId) {
    throw new InvalidSourceMappingError("Bound source workspace changed during projection.");
  }
  return source;
}

function requireMapping(mapping: SourceMappingInput): void {
  if (!mapping.sourceEntryId) throw new InvalidSourceMappingError("Projected objects require a preallocated SourceEntry ID.");
  if (!mapping.sourcePath) throw new InvalidSourceMappingError("Projected objects require a non-empty source path.");
  if (mapping.externalId !== null && mapping.externalId.length === 0) {
    throw new InvalidSourceMappingError("Projected external ID must be null or non-empty.");
  }
}

async function requireUniqueExternalId(
  repositories: SourceRepositories,
  sourceId: string,
  externalId: string | null,
): Promise<void> {
  if (externalId === null) return;
  if (await resolveByExternalId(repositories, sourceId, externalId)) throw new SourceEntryConflictError();
}

/**
 * Binds the §3 projection commands to the caller's already-open
 * SourceRepositories transaction and the authorized Source resolved by the
 * owning unit of work (spec §15.3).
 *
 * The returned commands never open a nested unit of work and never commit:
 * the owning orchestration commits once. Caller identity comes only from the
 * explicit first parameter of each command; a client-supplied sourceId or
 * mapping never overrides the bound scope — every command verifies its
 * target belongs to the bound Source and re-validates SOURCE_MANAGED
 * ownership, lifecycle, and transaction-scoped Workspace access on this
 * connection before writing. Projected objects and their SourceEntry mapping
 * are created in the same transaction from a preallocated sourceEntryId that
 * needs no preexisting committed row; each create returns only after the
 * mapping row is readable with all invariants holding.
 */
export function bindSourceProjection(
  repositories: SourceRepositories,
  bound: BoundProjectionSource,
  hints?: BoundProjectionHints,
): SourceKnowledgeProjectionService {
  async function archiveLinkedDocumentEntry(caller: CallerContext, documentId: string): Promise<void> {
    const linked = await repositories.entries.findByDocumentId(documentId);
    if (linked && linked.sourceId === bound.id) {
      await archiveSourceEntry(repositories, caller, bound.id, linked.id);
    }
  }

  async function restoreLinkedDocumentEntry(caller: CallerContext, documentId: string): Promise<void> {
    const linked = await repositories.entries.findByDocumentId(documentId);
    if (linked && linked.sourceId === bound.id) {
      await restoreSourceEntry(repositories, caller, bound.id, linked.id);
    }
  }

  function syncViewNode(nodeId: string, patch: Partial<Pick<TreeViewNode, "parentId" | "position" | "status" | "name">>): void {
    const node = hints?.treeView?.find((candidate) => candidate.id === nodeId);
    if (node) Object.assign(node, patch);
  }

  function syncViewDocumentStatus(documentId: string, status: "ACTIVE" | "ARCHIVED"): void {
    const node = hints?.treeView?.find((candidate) => candidate.documentId === documentId);
    if (node) {
      node.status = status;
      node.documentStatus = status;
    }
  }

  function syncViewCurrentRevision(documentId: string, revisionId: string): void {
    const node = hints?.treeView?.find((candidate) => candidate.documentId === documentId);
    if (node) node.currentRevisionId = revisionId;
  }

  function pushViewNode(node: TreeViewNode): void {
    hints?.treeView?.push(node);
  }

  function viewNodeById(nodeId: string): TreeViewNode | undefined {
    return hints?.treeView?.find((candidate) => candidate.id === nodeId);
  }

  async function treeNodeById(nodeId: string): Promise<KnowledgeTreeNode | null> {
    return viewNodeById(nodeId) ?? (await repositories.tree.findById(nodeId));
  }

  async function treeNodesBySource(sourceId: string): Promise<readonly TreeViewNode[]> {
    return hints?.treeView ?? (await repositories.tree.listBySource(sourceId));
  }

  async function moveNodeToParent(
    caller: CallerContext,
    source: SourcePolicy,
    nodeId: string,
    newParentId: string | null,
    newPosition: number,
  ): Promise<void> {
    const node = await requireLockedSourceNode(repositories, source.id, nodeId);
    const previousParentId = node.parentId;
    if (newParentId !== null) {
      if (newParentId === node.id) throw new TreeCycleError();
      const parent = await repositories.tree.lockById(newParentId);
      if (!parent) throw new TreeNodeNotFoundError("Parent folder was not found.");
      if (parent.sourceId !== source.id) throw new CrossSourceMoveError();
      if (parent.nodeType !== "FOLDER" || parent.status !== "ACTIVE") throw new InvalidParentError();
      await assertActiveFolderAncestry(repositories, source.id, parent.id, hints?.treeView);
      if (await repositories.tree.hasDescendant(node.id, parent.id)) throw new TreeCycleError();
    }
    await repositories.tree.updateParent(node.id, newParentId, caller.identity.id);
    syncViewNode(node.id, { parentId: newParentId });
    await placeNodeAtIndex(repositories, source.id, node.id, newParentId, newPosition, caller.identity.id, hints?.treeView);
    if (previousParentId !== newParentId) {
      await renumberSiblingPositions(repositories, source.id, previousParentId, caller.identity.id, hints?.treeView);
    }
  }

  async function archiveLinkedFolderEntry(caller: CallerContext, treeNodeId: string): Promise<void> {
    const linked = await repositories.entries.findByTreeNodeId(treeNodeId);
    if (linked && linked.sourceId === bound.id) {
      await archiveSourceEntry(repositories, caller, bound.id, linked.id);
    }
  }

  async function restoreLinkedFolderEntry(caller: CallerContext, treeNodeId: string): Promise<void> {
    const linked = await repositories.entries.findByTreeNodeId(treeNodeId);
    if (linked && linked.sourceId === bound.id) {
      await restoreSourceEntry(repositories, caller, bound.id, linked.id);
    }
  }

  return {
    async projectDocument(caller, input) {
      if (input.sourceId !== bound.id) {
        throw new InvalidSourceMappingError("Projected documents must target the bound authorized source.");
      }
      requireMapping(input.mapping);
      const source = await requireBoundSource(repositories, caller, bound, hints);
      await requireUniqueExternalId(repositories, source.id, input.mapping.externalId);
      const position = input.position === undefined ? undefined : normalizeTreePosition(input.position);
      if (input.parentId !== null) await assertActiveFolderAncestry(repositories, source.id, input.parentId, hints?.treeView);
      const siblings = (await treeNodesBySource(source.id)).filter((node) => node.parentId === input.parentId);
      const index = position === undefined ? siblings.length : Math.min(position, siblings.length);
      const { normalized: content, contentHash } = fingerprintRevisionContent(input);
      const now = new Date();
      const documentId = uuidv7();
      const revisionId = uuidv7();
      const treeNodeId = uuidv7();
      await repositories.documents.insertDraft({
        id: documentId, sourceId: source.id, currentRevisionId: null, status: "ACTIVE",
        createdBy: caller.identity.id, updatedBy: caller.identity.id,
        archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
      });
      await repositories.revisions.insert({
        id: revisionId, documentId, revisionNo: 1, ...content,
        contentHash, createdBy: caller.identity.id, createdAt: now,
      });
      await repositories.documents.setCurrentRevision(documentId, revisionId, caller.identity.id);
      const insertedNode: KnowledgeTreeNode = {
        id: treeNodeId, sourceId: source.id, parentId: input.parentId, nodeType: "DOCUMENT",
        name: null, documentId, position: index, status: "ACTIVE",
        updatedBy: caller.identity.id, archivedBy: null, archivedAt: null,
      };
      await repositories.tree.insert(insertedNode);
      pushViewNode({ ...insertedNode, title: content.title, documentStatus: "ACTIVE", currentRevisionId: revisionId });
      await placeNodeAtIndex(repositories, source.id, treeNodeId, input.parentId, index, caller.identity.id, hints?.treeView);
      await repositories.documents.assertComplete(documentId);
      await createSourceEntryMapping(repositories, caller, source.id, {
        sourceEntryId: input.mapping.sourceEntryId,
        externalId: input.mapping.externalId,
        sourcePath: input.mapping.sourcePath,
        entryType: "DOCUMENT",
        contentHash,
        documentId,
        treeNodeId,
      });
      const stored = await repositories.entries.findById(input.mapping.sourceEntryId);
      if (!stored || stored.documentId !== documentId || stored.treeNodeId !== treeNodeId) {
        throw new InvalidSourceMappingError("Projected document mapping is incomplete.");
      }
      return { documentId, revisionId, treeNodeId };
    },

    async projectRevision(caller, input) {
      const existing = await repositories.documents.findById(input.documentId);
      if (!existing) throw new DocumentNotFoundError();
      requireBoundDocumentSource(existing.sourceId, bound);
      const source = await requireBoundSource(repositories, caller, bound, hints);
      const document = await repositories.documents.lockById(input.documentId);
      if (!document || document.sourceId !== source.id) throw new DocumentNotFoundError();
      if (document.status !== "ACTIVE") throw new DocumentArchivedError();
      const current = await repositories.revisions.findCurrent(document.id);
      if (!current) throw new IntegrityViolationError("Document current revision is missing.");
      if (current.id !== input.expectedCurrentRevisionId) throw new RevisionConflictError();
      if (isRevisionContentUnchanged(current, input)) {
        return { revisionId: current.id, revisionNo: current.revisionNo, changed: false };
      }
      const { normalized: content, contentHash } = fingerprintRevisionContent(input);
      const revisionId = uuidv7();
      const revisionNo = await repositories.revisions.nextRevisionNumber(document.id);
      await repositories.revisions.insert({
        id: revisionId, documentId: document.id, revisionNo, ...content,
        contentHash, createdBy: caller.identity.id, createdAt: new Date(),
      });
      await repositories.documents.setCurrentRevision(document.id, revisionId, caller.identity.id);
      syncViewCurrentRevision(document.id, revisionId);
      await repositories.documents.assertComplete(document.id);
      return { revisionId, revisionNo, changed: true };
    },

    async projectFolder(caller, input) {
      if (input.sourceId !== bound.id) {
        throw new InvalidSourceMappingError("Projected folders must target the bound authorized source.");
      }
      requireMapping(input.mapping);
      const name = normalizeFolderName(input.name);
      const source = await requireBoundSource(repositories, caller, bound, hints);
      await requireUniqueExternalId(repositories, source.id, input.mapping.externalId);
      if (input.parentId !== null) {
        const parent = await repositories.tree.lockById(input.parentId);
        if (!parent) throw new TreeNodeNotFoundError("Parent folder was not found.");
        if (parent.sourceId !== source.id || parent.nodeType !== "FOLDER" || parent.status !== "ACTIVE") {
          throw new InvalidParentError();
        }
        await assertActiveFolderAncestry(repositories, source.id, parent.id, hints?.treeView);
      }
      const siblings = (await treeNodesBySource(source.id)).filter((node) => node.parentId === input.parentId);
      const position = input.position === undefined ? siblings.length : Math.min(normalizeTreePosition(input.position), siblings.length);
      const treeNodeId = uuidv7();
      const insertedNode: KnowledgeTreeNode = {
        id: treeNodeId, sourceId: source.id, parentId: input.parentId, nodeType: "FOLDER",
        name, documentId: null, position, status: "ACTIVE",
        updatedBy: caller.identity.id, archivedBy: null, archivedAt: null,
      };
      await repositories.tree.insert(insertedNode);
      pushViewNode({ ...insertedNode, title: name, documentStatus: null, currentRevisionId: null });
      await placeNodeAtIndex(repositories, source.id, treeNodeId, input.parentId, position, caller.identity.id, hints?.treeView);
      await createSourceEntryMapping(repositories, caller, source.id, {
        sourceEntryId: input.mapping.sourceEntryId,
        externalId: input.mapping.externalId,
        sourcePath: input.mapping.sourcePath,
        entryType: "FOLDER",
        contentHash: null,
        documentId: null,
        treeNodeId,
      });
      const stored = await repositories.entries.findById(input.mapping.sourceEntryId);
      if (!stored || stored.treeNodeId !== treeNodeId || stored.documentId !== null) {
        throw new InvalidSourceMappingError("Projected folder mapping is incomplete.");
      }
      return { treeNodeId };
    },

    async renameProjectedFolder(caller, input) {
      const routing = await treeNodeById(input.nodeId);
      requireBoundTreeSource(routing?.sourceId, bound);
      const name = normalizeFolderName(input.name);
      const source = await requireBoundSource(repositories, caller, bound, hints);
      const node = await requireLockedSourceNode(repositories, source.id, input.nodeId);
      if (node.nodeType !== "FOLDER") throw new ValidationError("Only folders can be renamed.");
      if (node.status !== "ACTIVE") throw new ValidationError("Archived folders cannot be renamed.");
      if (node.parentId) await assertActiveFolderAncestry(repositories, source.id, node.parentId, hints?.treeView);
      await repositories.tree.updateName(node.id, name, caller.identity.id);
      syncViewNode(node.id, { name });
      const linked = await repositories.entries.findByTreeNodeId(node.id);
      if (linked && linked.sourceId === source.id) {
        await repositories.entries.update({ ...linked, updatedBy: caller.identity.id, lastSeenAt: new Date() });
      }
    },

    async archiveProjectedFolder(caller, nodeId) {
      const routing = await treeNodeById(nodeId);
      requireBoundTreeSource(routing?.sourceId, bound);
      const source = await requireBoundSource(repositories, caller, bound, hints);
      const node = await requireLockedSourceNode(repositories, source.id, nodeId);
      if (node.nodeType !== "FOLDER") throw new ValidationError("Only folders can be archived.");
      if (node.status === "ARCHIVED") return;
      if (node.parentId) await assertActiveFolderAncestry(repositories, source.id, node.parentId, hints?.treeView);
      const nodes = await treeNodesBySource(source.id);
      if (nodes.some((candidate) => candidate.parentId === node.id && candidate.status === "ACTIVE")) {
        throw new FolderNotEmptyError();
      }
      await repositories.tree.updateStatus(node.id, "ARCHIVED", caller.identity.id);
      syncViewNode(node.id, { status: "ARCHIVED" });
      await archiveLinkedFolderEntry(caller, node.id);
    },

    async restoreProjectedFolder(caller, nodeId) {
      const routing = await treeNodeById(nodeId);
      requireBoundTreeSource(routing?.sourceId, bound);
      const source = await requireBoundSource(repositories, caller, bound, hints);
      const node = await requireLockedSourceNode(repositories, source.id, nodeId);
      if (node.nodeType !== "FOLDER") throw new ValidationError("Only folders can be restored.");
      if (node.status === "ACTIVE") return;
      if (node.parentId) await assertActiveFolderAncestry(repositories, source.id, node.parentId, hints?.treeView);
      await repositories.tree.updateStatus(node.id, "ACTIVE", caller.identity.id);
      syncViewNode(node.id, { status: "ACTIVE" });
      await restoreLinkedFolderEntry(caller, node.id);
    },

    async moveProjectedNode(caller, input) {
      const newPosition = normalizeTreePosition(input.newPosition);
      const routing = await treeNodeById(input.nodeId);
      requireBoundTreeSource(routing?.sourceId, bound);
      const source = await requireBoundSource(repositories, caller, bound, hints);
      const node = await requireLockedSourceNode(repositories, source.id, input.nodeId);
      if (node.status !== "ACTIVE") throw new ValidationError("Archived tree nodes cannot be moved.");
      await moveNodeToParent(caller, source, node.id, input.newParentId, newPosition);
    },

    async archiveProjectedDocument(caller, documentId) {
      const existing = await repositories.documents.findById(documentId);
      if (!existing) throw new DocumentNotFoundError();
      requireBoundDocumentSource(existing.sourceId, bound);
      const source = await requireBoundSource(repositories, caller, bound, hints);
      const document = await repositories.documents.lockById(documentId);
      if (!document || document.sourceId !== source.id) throw new DocumentNotFoundError();
      if (document.status === "ARCHIVED") return;
      const nodes = await treeNodesBySource(source.id);
      const node = nodes.find((candidate) => candidate.documentId === document.id);
      if (!node) throw new TreeNodeNotFoundError("Document tree node was not found.");
      await requireLockedSourceNode(repositories, source.id, node.id);
      await repositories.documents.updateStatus(document.id, "ARCHIVED", caller.identity.id);
      await repositories.tree.updateStatusForDocument(document.id, "ARCHIVED", caller.identity.id);
      syncViewDocumentStatus(document.id, "ARCHIVED");
      await archiveLinkedDocumentEntry(caller, document.id);
    },

    async restoreProjectedDocument(caller, documentId) {
      const existing = await repositories.documents.findById(documentId);
      if (!existing) throw new DocumentNotFoundError();
      requireBoundDocumentSource(existing.sourceId, bound);
      const source = await requireBoundSource(repositories, caller, bound, hints);
      const document = await repositories.documents.lockById(existing.id);
      if (!document || document.sourceId !== source.id) throw new DocumentNotFoundError();
      if (document.status === "ACTIVE") return;
      const nodes = await treeNodesBySource(source.id);
      const node = nodes.find((candidate) => candidate.documentId === document.id);
      if (!node) throw new TreeNodeNotFoundError("Document tree node was not found.");
      await requireLockedSourceNode(repositories, source.id, node.id);
      await assertActiveDocumentPlacement(repositories, source.id, document.id, hints?.treeView);
      await repositories.documents.updateStatus(document.id, "ACTIVE", caller.identity.id);
      await repositories.tree.updateStatusForDocument(document.id, "ACTIVE", caller.identity.id);
      syncViewDocumentStatus(document.id, "ACTIVE");
      await restoreLinkedDocumentEntry(caller, document.id);
    },

    async restoreProjectedDocumentToParent(caller, input) {
      const existing = await repositories.documents.findById(input.documentId);
      if (!existing) throw new DocumentNotFoundError();
      requireBoundDocumentSource(existing.sourceId, bound);
      const source = await requireBoundSource(repositories, caller, bound, hints);
      const document = await repositories.documents.lockById(existing.id);
      if (!document || document.sourceId !== source.id) throw new DocumentNotFoundError();
      if (document.status === "ACTIVE") {
        const nodes = await treeNodesBySource(source.id);
        const activeNode = nodes.find((candidate) => candidate.documentId === document.id);
        if (!activeNode) throw new TreeNodeNotFoundError("Document tree node was not found.");
        await requireLockedSourceNode(repositories, source.id, activeNode.id);
        await moveNodeToParent(caller, source, activeNode.id, input.newParentId, normalizeTreePosition(input.newPosition));
        return;
      }
      const nodes = await treeNodesBySource(source.id);
      const node = nodes.find((candidate) => candidate.documentId === document.id);
      if (!node) throw new TreeNodeNotFoundError("Document tree node was not found.");
      await requireLockedSourceNode(repositories, source.id, node.id);
      // Placement is validated against the TARGET parent only: the archived
      // node may sit below an archived old parent, and restoring straight
      // into an active target never exposes an active document below archived ancestry.
      await moveNodeToParent(caller, source, node.id, input.newParentId, normalizeTreePosition(input.newPosition));
      await repositories.documents.updateStatus(document.id, "ACTIVE", caller.identity.id);
      await repositories.tree.updateStatusForDocument(document.id, "ACTIVE", caller.identity.id);
      syncViewDocumentStatus(document.id, "ACTIVE");
      await restoreLinkedDocumentEntry(caller, document.id);
    },
  };
}
