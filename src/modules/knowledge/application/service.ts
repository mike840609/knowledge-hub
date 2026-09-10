import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { contentFingerprint, normalizeContent, sameContent, type ContentInput } from "../domain/content";
import { DocumentNotFoundError, IntegrityViolationError, SourceArchivedError, SourceNotFoundError, SourceReadOnlyError, TreeCycleError, InvalidParentError, TreeNodeNotFoundError, ValidationError } from "../domain/errors";
import type { KnowledgeDocument } from "../domain/document";
import type { KnowledgeRevision } from "../domain/revision";
import type { KnowledgeTreeNode } from "../domain/tree-node";
import type { KnowledgeRepositories, KnowledgeUnitOfWork } from "../ports/unit-of-work";
import { applySourceManagedMutation, archiveSourceManagedDocument, type ControlledKnowledgeOperations, type SourceManagedMutation } from "./mutations";
import { assertActiveDocumentPlacement, assertActiveFolderAncestry } from "./tree-validation";

export type CreateDocumentInput = ContentInput & { sourceId: string; parentId?: string | null };
export type RevisionResult = { documentId: string; revisionId: string; revisionNo: number; changed: boolean };
export type DocumentView = {
  document: KnowledgeDocument;
  revision: KnowledgeRevision;
  source: { id: string; workspaceId: string; ownership: string; sourceType: string };
};
export type TreeItem = { id: string; nodeType: "FOLDER" | "DOCUMENT"; name: string; documentId: string | null; children: TreeItem[] };

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

function buildTree(nodes: Awaited<ReturnType<KnowledgeRepositories["tree"]["listBySource"]>>): TreeItem[] {
  const byParent = new Map<string | null, TreeItem[]>();
  const byId = new Map<string, TreeItem>();
  for (const node of nodes) {
    if (node.status !== "ACTIVE" || node.documentStatus === "ARCHIVED") continue;
    const name = node.nodeType === "FOLDER" ? node.name : node.title;
    if (!name || (node.nodeType === "DOCUMENT" && !node.documentId)) continue;
    const item: TreeItem = { id: node.id, nodeType: node.nodeType, name, documentId: node.documentId, children: [] };
    byId.set(node.id, item);
    const siblings = byParent.get(node.parentId) ?? [];
    siblings.push(item);
    byParent.set(node.parentId, siblings);
  }
  for (const node of nodes) {
    if (node.parentId && byId.has(node.parentId) && byId.has(node.id)) byId.get(node.parentId)?.children.push(byId.get(node.id)!);
  }
  return byParent.get(null) ?? [];
}

export class KnowledgeApplicationService implements ControlledKnowledgeOperations {
  private readonly unitOfWork: KnowledgeUnitOfWork;

  constructor(unitOfWork: KnowledgeUnitOfWork) { this.unitOfWork = unitOfWork; }

  async createHubManagedDocument(caller: CallerContext, input: CreateDocumentInput): Promise<{ documentId: string; revisionId: string }> {
    const content = normalizeContent(input);
    return this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      const source = requireHubSource(await requireSourceAccess(repositories, caller, input.sourceId, true));
      if (input.parentId) await assertActiveFolderAncestry(repositories, source.id, input.parentId);
      const now = new Date();
      const documentId = uuidv7();
      const revisionId = uuidv7();
      await repositories.documents.insertDraft({ id: documentId, sourceId: source.id, currentRevisionId: null, status: "ACTIVE", createdBy: caller.identity.id, updatedBy: caller.identity.id, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now });
      await repositories.revisions.insert({ id: revisionId, documentId, revisionNo: 1, ...content, contentHash: contentFingerprint(content), createdBy: caller.identity.id, createdAt: now });
      await repositories.documents.setCurrentRevision(documentId, revisionId, caller.identity.id);
      await repositories.tree.insert({ id: uuidv7(), sourceId: source.id, parentId: input.parentId ?? null, nodeType: "DOCUMENT", name: null, documentId, position: 0, status: "ACTIVE", updatedBy: caller.identity.id, archivedBy: null, archivedAt: null });
      await repositories.documents.assertComplete(documentId);
      return { documentId, revisionId };
    });
  }

  async getDocument(caller: CallerContext, documentId: string, options: { includeArchived?: boolean } = {}): Promise<DocumentView | null> {
    return this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      const document = await repositories.documents.findById(documentId);
      if (!document) return null;
      const source = await requireSourceAccess(repositories, caller, document.sourceId);
      if ((!options.includeArchived && document.status !== "ACTIVE") || (!options.includeArchived && source.status !== "ACTIVE")) return null;
      const revision = await repositories.revisions.findCurrent(document.id);
      if (!revision) throw new IntegrityViolationError("Document current revision is missing.");
      return { document, revision, source: { id: source.id, workspaceId: source.workspaceId, ownership: source.ownership, sourceType: source.sourceType } };
    });
  }

  async getCurrentRevision(caller: CallerContext, documentId: string, options: { includeArchived?: boolean } = {}): Promise<KnowledgeRevision | null> {
    const view = await this.getDocument(caller, documentId, options);
    return view?.revision ?? null;
  }

  async listTree(caller: CallerContext, sourceId: string): Promise<TreeItem[]> {
    return this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      const source = await requireSourceAccess(repositories, caller, sourceId);
      if (source.status !== "ACTIVE") return [];
      return buildTree(await repositories.tree.listBySource(sourceId));
    });
  }

  async createRevision(caller: CallerContext, documentId: string, input: ContentInput): Promise<RevisionResult> {
    const content = normalizeContent(input);
    return this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      const existing = await repositories.documents.findById(documentId);
      if (!existing) throw new DocumentNotFoundError();
      requireHubSource(await requireSourceAccess(repositories, caller, existing.sourceId, true));
      const document = await repositories.documents.lockById(documentId);
      if (!document) throw new DocumentNotFoundError();
      const current = await repositories.revisions.findCurrent(document.id);
      if (!current) throw new IntegrityViolationError("Document current revision is missing.");
      if (sameContent(current, content)) return { documentId, revisionId: current.id, revisionNo: current.revisionNo, changed: false };
      const revisionId = uuidv7();
      const revisionNo = await repositories.revisions.nextRevisionNumber(document.id);
      await repositories.revisions.insert({ id: revisionId, documentId, revisionNo, ...content, contentHash: contentFingerprint(content), createdBy: caller.identity.id, createdAt: new Date() });
      await repositories.documents.setCurrentRevision(document.id, revisionId, caller.identity.id);
      await repositories.documents.assertComplete(document.id);
      return { documentId, revisionId, revisionNo, changed: true };
    });
  }

  async archiveDocument(caller: CallerContext, documentId: string): Promise<void> {
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
    if (!Number.isSafeInteger(position) || position < 0) throw new ValidationError("Tree position must be a non-negative integer.");
    await this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      const existing = await repositories.tree.findById(nodeId);
      if (!existing) throw new TreeNodeNotFoundError();
      requireHubSource(await requireSourceAccess(repositories, caller, existing.sourceId, true));
      await repositories.tree.updatePosition(nodeId, position, caller.identity.id);
    });
  }

  applySourceManagedMutation(repositories: KnowledgeRepositories, input: SourceManagedMutation): Promise<RevisionResult> {
    return applySourceManagedMutation(repositories, input);
  }

  archiveSourceManagedDocument(repositories: KnowledgeRepositories, documentId: string, actorId: string): Promise<void> {
    return archiveSourceManagedDocument(repositories, documentId, actorId);
  }
}
