import type { KnowledgeRevision, KnowledgeRevisionHead, KnowledgeRevisionSummary } from "../domain/revision";

export interface RevisionRepository {
  markCheckpoint(id: string, reason: string, name?: string): Promise<void>;
  pruneWorking(documentId: string): Promise<void>;
  insert(revision: KnowledgeRevision): Promise<void>;
  /** Many revisions in few statements; for a bulk create in one transaction. */
  insertMany(revisions: readonly KnowledgeRevision[]): Promise<void>;
  findById(id: string): Promise<KnowledgeRevision | null>;
  /** Many revisions in few statements; returns only the ids that exist. */
  findByIds(ids: readonly string[]): Promise<KnowledgeRevision[]>;
  /** Like `findByIds` without the body: no Markdown or metadata is read. */
  findHeadsByIds(ids: readonly string[]): Promise<KnowledgeRevisionHead[]>;
  findCurrent(documentId: string): Promise<KnowledgeRevision | null>;
  findByRevisionNo(documentId: string, revisionNo: number): Promise<KnowledgeRevision | null>;
  listByDocument(documentId: string): Promise<KnowledgeRevision[]>;
  listSummariesByDocument(documentId: string): Promise<KnowledgeRevisionSummary[]>;
  nextRevisionNumber(documentId: string): Promise<number>;
}
