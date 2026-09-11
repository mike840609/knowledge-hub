import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { DocumentNotFoundError, TreeNodeNotFoundError } from "../../domain/errors";
import type { KnowledgeTreeNode } from "../../domain/tree-node";
import type { KnowledgeRepositories } from "../../ports/unit-of-work";
import { assertActiveDocumentPlacement } from "../tree-validation";
import { requireHubManagedSource } from "./tree-transaction";

/**
 * Hub-managed document lifecycle bound to an already-open canonical
 * transaction.
 *
 * Path (spec §18/§19, plan §6): trusted CallerContext → resolve Document →
 * lock Source FOR UPDATE on this connection → transaction-scoped Workspace
 * access → Source ACTIVE + HUB_MANAGED → lock Document → lock its TreeNode →
 * lifecycle validation → atomic Document + TreeNode + linked SourceEntry
 * status/provenance writes. Revisions and the current revision pointer are
 * never touched; the Document ID is stable. Never opens a nested unit of
 * work; the owning service commits once.
 */
async function requireLockedDocumentNode(
  repositories: KnowledgeRepositories,
  sourceId: string,
  documentId: string,
): Promise<KnowledgeTreeNode> {
  const node = (await repositories.tree.listBySource(sourceId)).find(
    (candidate) => candidate.documentId === documentId,
  );
  if (!node) throw new TreeNodeNotFoundError("Document tree node was not found.");
  const locked = await repositories.tree.lockById(node.id);
  if (!locked || locked.sourceId !== sourceId || locked.documentId !== documentId) {
    throw new TreeNodeNotFoundError("Document tree node was not found in this source.");
  }
  return locked;
}

export async function archiveDocumentInTransaction(
  repositories: KnowledgeRepositories,
  caller: CallerContext,
  documentId: string,
): Promise<void> {
  const existing = await repositories.documents.findById(documentId);
  if (!existing) throw new DocumentNotFoundError();
  const source = await requireHubManagedSource(repositories, caller, existing.sourceId);
  const document = await repositories.documents.lockById(documentId);
  if (!document || document.sourceId !== source.id) throw new DocumentNotFoundError();
  if (document.status === "ARCHIVED") return;
  await requireLockedDocumentNode(repositories, source.id, document.id);
  const now = new Date();
  await repositories.documents.updateStatus(document.id, "ARCHIVED", caller.identity.id);
  await repositories.tree.updateStatusForDocument(document.id, "ARCHIVED", caller.identity.id);
  const linked = await repositories.linkedEntries.findByDocumentId(document.id);
  if (linked && linked.sourceId === source.id) {
    await repositories.linkedEntries.update({
      ...linked,
      status: "ARCHIVED",
      updatedBy: caller.identity.id,
      archivedBy: caller.identity.id,
      archivedAt: now,
      lastSeenAt: now,
    });
  }
}

export async function restoreDocumentInTransaction(
  repositories: KnowledgeRepositories,
  caller: CallerContext,
  documentId: string,
): Promise<void> {
  const existing = await repositories.documents.findById(documentId);
  if (!existing) throw new DocumentNotFoundError();
  const source = await requireHubManagedSource(repositories, caller, existing.sourceId);
  const document = await repositories.documents.lockById(documentId);
  if (!document || document.sourceId !== source.id) throw new DocumentNotFoundError();
  if (document.status === "ACTIVE") return;
  await requireLockedDocumentNode(repositories, source.id, document.id);
  await assertActiveDocumentPlacement(repositories, source.id, document.id);
  await repositories.documents.updateStatus(document.id, "ACTIVE", caller.identity.id);
  await repositories.tree.updateStatusForDocument(document.id, "ACTIVE", caller.identity.id);
  const linked = await repositories.linkedEntries.findByDocumentId(document.id);
  if (linked && linked.sourceId === source.id) {
    await repositories.linkedEntries.update({
      ...linked,
      status: "ACTIVE",
      updatedBy: caller.identity.id,
      archivedBy: null,
      archivedAt: null,
      lastSeenAt: linked.lastSeenAt,
    });
  }
}
