import type { KnowledgeDocument } from "../domain/document";

export interface DocumentRepository {
  insertDraft(document: KnowledgeDocument): Promise<void>;
  findById(id: string): Promise<KnowledgeDocument | null>;
  lockById(id: string): Promise<KnowledgeDocument | null>;
  setCurrentRevision(documentId: string, revisionId: string, updatedBy: string): Promise<void>;
  assertComplete(documentId: string): Promise<void>;
  updateStatus(documentId: string, status: "ACTIVE" | "ARCHIVED", actorId: string): Promise<void>;
}
