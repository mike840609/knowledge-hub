import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { fingerprintRevisionContent, type RevisionContentInput } from "../../domain/content";
import { SourceArchivedError, SourceNotFoundError, SourceReadOnlyError, ValidationError } from "../../domain/errors";
import type { KnowledgeRepositories } from "../../ports/unit-of-work";
import { assertActiveFolderAncestry } from "../tree-validation";

export type CreateHubDocumentInput = RevisionContentInput & {
  sourceId: string;
  parentId: string | null;
  position?: number;
};

/**
 * Hub-managed document creation bound to an already-open canonical transaction.
 *
 * Path (§6): trusted CallerContext → resolve/lock Source on this connection →
 * transaction-scoped WorkspaceAccessPolicy → Source ACTIVE + HUB_MANAGED →
 * parent validation → atomic Document + R1 + TreeNode + pointer writes.
 * Never opens a nested unit of work; the owning service commits once.
 */
export async function createDocumentInTransaction(
  repositories: KnowledgeRepositories,
  caller: CallerContext,
  input: CreateHubDocumentInput,
): Promise<{ documentId: string; revisionId: string; treeNodeId: string }> {
  await repositories.users.upsertIdentity(caller.identity);
  const source = await repositories.sourcePolicy.lockById(input.sourceId);
  if (!source) throw new SourceNotFoundError();
  await repositories.workspaceAccess.requireMembership(caller, source.workspaceId);
  if (source.status !== "ACTIVE") throw new SourceArchivedError();
  if (source.ownership !== "HUB_MANAGED") throw new SourceReadOnlyError();
  let position = 0;
  if (input.position !== undefined) {
    if (!Number.isSafeInteger(input.position) || input.position < 0) {
      throw new ValidationError("Tree position must be a non-negative integer.");
    }
    position = input.position;
  }
  if (input.parentId !== null) await assertActiveFolderAncestry(repositories, source.id, input.parentId);
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
  await repositories.tree.insert({
    id: treeNodeId, sourceId: source.id, parentId: input.parentId, nodeType: "DOCUMENT",
    name: null, documentId, position, status: "ACTIVE",
    updatedBy: caller.identity.id, archivedBy: null, archivedAt: null,
  });
  await repositories.documents.assertComplete(documentId);
  return { documentId, revisionId, treeNodeId };
}
