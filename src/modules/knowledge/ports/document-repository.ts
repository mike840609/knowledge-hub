import type { KnowledgeDocument } from "../domain/document";

export interface DocumentRepository {
  insertDraft(document: KnowledgeDocument): Promise<void>;
  /** Many drafts in few statements; for a bulk create in one transaction. */
  insertDrafts(documents: readonly KnowledgeDocument[]): Promise<void>;
  findById(id: string): Promise<KnowledgeDocument | null>;
  /** Many documents in few statements; missing ids are simply absent. */
  findByIds(ids: readonly string[]): Promise<KnowledgeDocument[]>;
  lockById(id: string): Promise<KnowledgeDocument | null>;
  setCurrentRevision(documentId: string, revisionId: string, updatedBy: string): Promise<void>;
  /** Points each new document at its only revision. Every document must have exactly one. */
  setFirstRevisions(documentIds: readonly string[], updatedBy: string): Promise<void>;
  assertComplete(documentId: string): Promise<void>;
  assertCompleteMany(documentIds: readonly string[]): Promise<void>;
  updateStatus(documentId: string, status: "ACTIVE" | "ARCHIVED", actorId: string): Promise<void>;
  /** Sets or clears the page's emoji; it is presentation, not a revision. */
  updatePageIcon(documentId: string, icon: string | null, actorId: string): Promise<void>;
}
