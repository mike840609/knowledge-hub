import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { fingerprintRevisionContent, type ContentInput } from "../domain/content";
import { isRevisionContentUnchanged } from "../domain/revision";
import { DocumentNotFoundError, IntegrityViolationError, SourceArchivedError, SourceNotFoundError, SourceReadOnlyError, TreeCycleError, InvalidParentError, TreeNodeNotFoundError, ValidationError } from "../domain/errors";
import type { KnowledgeTreeNode } from "../domain/tree-node";
import type { KnowledgeRepositories, KnowledgeUnitOfWork } from "../ports/unit-of-work";
import { assertActiveDocumentPlacement, assertActiveFolderAncestry } from "./tree-validation";
import type { HubKnowledgeCommandService } from "./hub-knowledge-command-service";

/** Temporary Task 4–6 delegation target. Removed with service.ts in Task 9. */
export type HubCommandDelegate = Pick<HubKnowledgeCommandService, "createDocument" | "createRevision" | "createFolder" | "renameFolder" | "moveTreeNode" | "reorderTreeNode" | "archiveDocument" | "restoreDocument" | "archiveFolder" | "restoreFolder">;

export type CreateDocumentInput = ContentInput & { sourceId: string; parentId?: string | null };
export type RevisionResult = { documentId: string; revisionId: string; revisionNo: number; changed: boolean };

function requireHubSource(source: Awaited<ReturnType<typeof requireSource>>) {
  if (source.status !== "ACTIVE") throw new SourceArchivedError();
  if (source.ownership !== "HUB_MANAGED") throw new SourceReadOnlyError();
  return source;
}

async function requireSource(repositories: KnowledgeRepositories, sourceId: string, lock = false) {
  const source = lock ? await repositories.sourcePolicy.lockById(sourceId) : await repositories.sourcePolicy.findById(sourceId);
  if (!source) throw new SourceNotFoundError();
  return source;
}

async function requireSourceAccess(repositories: KnowledgeRepositories, caller: CallerContext, sourceId: string, lock = false) {
  const source = await requireSource(repositories, sourceId, lock);
  await repositories.workspaceAccess.requireMembership(caller, source.workspaceId);
  return source;
}

function requireFolderParent(parent: KnowledgeTreeNode | null, sourceId: string): asserts parent is KnowledgeTreeNode {
  if (!parent || parent.sourceId !== sourceId || parent.nodeType !== "FOLDER" || parent.status !== "ACTIVE") {
    throw new InvalidParentError();
  }
}

export class KnowledgeApplicationService {
  private readonly unitOfWork: KnowledgeUnitOfWork;
  private readonly hub?: HubCommandDelegate;

  constructor(unitOfWork: KnowledgeUnitOfWork, hub?: HubCommandDelegate) {
    this.unitOfWork = unitOfWork;
    this.hub = hub;
  }

  async createHubManagedDocument(caller: CallerContext, input: CreateDocumentInput): Promise<{ documentId: string; revisionId: string }> {
    if (this.hub) {
      const created = await this.hub.createDocument(caller, {
        sourceId: input.sourceId, parentId: input.parentId ?? null,
        title: input.title, markdown: input.markdown, metadata: input.metadata,
      });
      return { documentId: created.documentId, revisionId: created.revisionId };
    }
    const { normalized: content, contentHash } = fingerprintRevisionContent(input);
    return this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      const source = requireHubSource(await requireSourceAccess(repositories, caller, input.sourceId, true));
      if (input.parentId) await assertActiveFolderAncestry(repositories, source.id, input.parentId);
      const now = new Date();
      const documentId = uuidv7();
      const revisionId = uuidv7();
      await repositories.documents.insertDraft({ id: documentId, sourceId: source.id, currentRevisionId: null, status: "ACTIVE", createdBy: caller.identity.id, updatedBy: caller.identity.id, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now });
      await repositories.revisions.insert({ id: revisionId, documentId, revisionNo: 1, ...content, contentHash, createdBy: caller.identity.id, createdAt: now });
      await repositories.documents.setCurrentRevision(documentId, revisionId, caller.identity.id);
      await repositories.tree.insert({ id: uuidv7(), sourceId: source.id, parentId: input.parentId ?? null, nodeType: "DOCUMENT", name: null, documentId, position: 0, status: "ACTIVE", updatedBy: caller.identity.id, archivedBy: null, archivedAt: null });
      await repositories.documents.assertComplete(documentId);
      return { documentId, revisionId };
    });
  }

  async createRevision(caller: CallerContext, documentId: string, input: ContentInput): Promise<RevisionResult> {
    if (this.hub) {
      const current = await this.unitOfWork.run(async (repositories) => repositories.revisions.findCurrent(documentId));
      if (!current) throw new DocumentNotFoundError();
      const revised = await this.hub.createRevision(caller, {
        documentId, expectedCurrentRevisionId: current.id,
        title: input.title, markdown: input.markdown, metadata: input.metadata,
      });
      return { documentId, revisionId: revised.revisionId, revisionNo: revised.revisionNo, changed: revised.changed };
    }
    const { normalized: content, contentHash } = fingerprintRevisionContent(input);
    return this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      const existing = await repositories.documents.findById(documentId);
      if (!existing) throw new DocumentNotFoundError();
      requireHubSource(await requireSourceAccess(repositories, caller, existing.sourceId, true));
      const document = await repositories.documents.lockById(documentId);
      if (!document) throw new DocumentNotFoundError();
      const current = await repositories.revisions.findCurrent(document.id);
      if (!current) throw new IntegrityViolationError("Document current revision is missing.");
      if (isRevisionContentUnchanged(current, input)) return { documentId, revisionId: current.id, revisionNo: current.revisionNo, changed: false };
      const revisionId = uuidv7();
      const revisionNo = await repositories.revisions.nextRevisionNumber(document.id);
      await repositories.revisions.insert({ id: revisionId, documentId, revisionNo, ...content, contentHash, createdBy: caller.identity.id, createdAt: new Date() });
      await repositories.documents.setCurrentRevision(document.id, revisionId, caller.identity.id);
      await repositories.documents.assertComplete(document.id);
      return { documentId, revisionId, revisionNo, changed: true };
    });
  }

  async archiveDocument(caller: CallerContext, documentId: string): Promise<void> {
    if (this.hub) {
      await this.hub.archiveDocument(caller, documentId);
      return;
    }
    await this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      const existing = await repositories.documents.findById(documentId);
      if (!existing) throw new DocumentNotFoundError();
      requireHubSource(await requireSourceAccess(repositories, caller, existing.sourceId, true));
      const document = await repositories.documents.lockById(documentId);
      if (!document) throw new DocumentNotFoundError();
      await repositories.documents.updateStatus(documentId, "ARCHIVED", caller.identity.id);
      await repositories.tree.updateStatusForDocument(documentId, "ARCHIVED", caller.identity.id);
    });
  }

  async restoreDocument(caller: CallerContext, documentId: string): Promise<void> {
    if (this.hub) {
      await this.hub.restoreDocument(caller, documentId);
      return;
    }
    await this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      const existing = await repositories.documents.findById(documentId);
      if (!existing) throw new DocumentNotFoundError();
      requireHubSource(await requireSourceAccess(repositories, caller, existing.sourceId, true));
      const document = await repositories.documents.lockById(documentId);
      if (!document) throw new DocumentNotFoundError();
      await assertActiveDocumentPlacement(repositories, document.sourceId, documentId);
      await repositories.documents.updateStatus(documentId, "ACTIVE", caller.identity.id);
      await repositories.tree.updateStatusForDocument(documentId, "ACTIVE", caller.identity.id);
    });
  }

  async moveTreeNode(caller: CallerContext, nodeId: string, parentId: string | null): Promise<void> {
    if (this.hub) {
      const current = await this.unitOfWork.run(async (repositories) => repositories.tree.findById(nodeId));
      if (!current) throw new TreeNodeNotFoundError();
      await this.hub.moveTreeNode(caller, { nodeId, newParentId: parentId, newPosition: current.position });
      return;
    }
    await this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      const existing = await repositories.tree.findById(nodeId);
      if (!existing) throw new TreeNodeNotFoundError();
      requireHubSource(await requireSourceAccess(repositories, caller, existing.sourceId, true));
      const node = await repositories.tree.lockById(nodeId);
      if (!node) throw new TreeNodeNotFoundError();
      if (node.status !== "ACTIVE") throw new ValidationError("Archived tree nodes cannot be moved.");
      if (parentId) {
        const parent = await repositories.tree.lockById(parentId);
        requireFolderParent(parent, node.sourceId);
        await assertActiveFolderAncestry(repositories, node.sourceId, parent.id);
        if (parent.id === node.id || await repositories.tree.hasDescendant(node.id, parent.id)) throw new TreeCycleError();
      }
      await repositories.tree.updateParent(node.id, parentId, caller.identity.id);
    });
  }

  async renameFolder(caller: CallerContext, nodeId: string, name: string): Promise<void> {
    if (this.hub) {
      await this.hub.renameFolder(caller, { nodeId, name });
      return;
    }
    if (!name) throw new ValidationError("Folder name must be a non-empty string.");
    await this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      const existing = await repositories.tree.findById(nodeId);
      if (!existing) throw new TreeNodeNotFoundError();
      requireHubSource(await requireSourceAccess(repositories, caller, existing.sourceId, true));
      const node = await repositories.tree.lockById(nodeId);
      if (!node) throw new TreeNodeNotFoundError();
      if (node.nodeType !== "FOLDER") throw new ValidationError("Only folders can be renamed.");
      await repositories.tree.updateName(nodeId, name, caller.identity.id);
    });
  }

  async reorderNode(caller: CallerContext, nodeId: string, position: number): Promise<void> {
    if (this.hub) {
      await this.hub.reorderTreeNode(caller, { nodeId, newPosition: position });
      return;
    }
    if (!Number.isSafeInteger(position) || position < 0) throw new ValidationError("Tree position must be a non-negative integer.");
    await this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      const existing = await repositories.tree.findById(nodeId);
      if (!existing) throw new TreeNodeNotFoundError();
      requireHubSource(await requireSourceAccess(repositories, caller, existing.sourceId, true));
      await repositories.tree.updatePosition(nodeId, position, caller.identity.id);
    });
  }
}
