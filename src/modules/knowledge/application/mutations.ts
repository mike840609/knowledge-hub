import { uuidv7 } from "@/shared/ids/uuidv7";
import { contentFingerprint, normalizeContent, sameContent, type ContentInput } from "../domain/content";
import { IntegrityError, NotFoundError } from "../domain/errors";
import type { KnowledgeRepositories } from "../ports/unit-of-work";
import { assertActiveDocumentPlacement } from "./tree-validation";

export type SourceManagedMutation = {
  documentId: string;
  content: ContentInput;
  callerId: string;
  restore?: boolean;
};

export type MutationResult = {
  documentId: string;
  revisionId: string;
  revisionNo: number;
  changed: boolean;
};

export interface ControlledKnowledgeOperations {
  applySourceManagedMutation(repositories: KnowledgeRepositories, input: SourceManagedMutation): Promise<MutationResult>;
  archiveSourceManagedDocument(repositories: KnowledgeRepositories, documentId: string, actorId: string): Promise<void>;
}

export async function applySourceManagedMutation(
  repositories: KnowledgeRepositories,
  input: SourceManagedMutation,
): Promise<MutationResult> {
  const existing = await repositories.documents.findById(input.documentId);
  if (!existing) throw new NotFoundError("Knowledge document was not found.");
  const source = await repositories.sourcePolicy.lockById(existing.sourceId);
  if (!source || source.status !== "ACTIVE" || source.ownership !== "SOURCE_MANAGED") {
    throw new IntegrityError("Controlled source mutation requires an active SOURCE_MANAGED source.");
  }
  const document = await repositories.documents.lockById(input.documentId);
  if (!document) throw new NotFoundError("Knowledge document was not found.");
  const content = normalizeContent(input.content);
  const current = await repositories.revisions.findCurrent(document.id);
  if (!current) throw new IntegrityError("Document has no current revision.");
  let revisionId = current.id;
  let revisionNo = current.revisionNo;
  const changed = !sameContent(current, content);
  if (changed) {
    revisionId = uuidv7();
    revisionNo = await repositories.revisions.nextRevisionNumber(document.id);
    await repositories.revisions.insert({
      id: revisionId, documentId: document.id, revisionNo, ...content,
      contentHash: contentFingerprint(content), createdBy: input.callerId, createdAt: new Date(),
    });
      await repositories.documents.setCurrentRevision(document.id, revisionId, input.callerId);
  }
  if (input.restore) {
    await assertActiveDocumentPlacement(repositories, document.sourceId, document.id);
    await repositories.documents.updateStatus(document.id, "ACTIVE", input.callerId);
    await repositories.tree.updateStatusForDocument(document.id, "ACTIVE", input.callerId);
  }
  await repositories.documents.assertComplete(document.id);
  return { documentId: document.id, revisionId, revisionNo, changed };
}

export async function archiveSourceManagedDocument(repositories: KnowledgeRepositories, documentId: string, actorId: string): Promise<void> {
  const existing = await repositories.documents.findById(documentId);
  if (!existing) throw new NotFoundError("Knowledge document was not found.");
  const source = await repositories.sourcePolicy.lockById(existing.sourceId);
  if (!source || source.status !== "ACTIVE" || source.ownership !== "SOURCE_MANAGED") throw new IntegrityError("Controlled source mutation requires an active SOURCE_MANAGED source.");
  const document = await repositories.documents.lockById(documentId);
  if (!document) throw new NotFoundError("Knowledge document was not found.");
  await repositories.documents.updateStatus(document.id, "ARCHIVED", actorId);
  await repositories.tree.updateStatusForDocument(document.id, "ARCHIVED", actorId);
}
