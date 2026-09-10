import type { KnowledgeRevision } from "../domain/revision";

export interface RevisionRepository {
  insert(revision: KnowledgeRevision): Promise<void>;
  findById(id: string): Promise<KnowledgeRevision | null>;
  findCurrent(documentId: string): Promise<KnowledgeRevision | null>;
  nextRevisionNumber(documentId: string): Promise<number>;
}
