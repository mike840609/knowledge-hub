import type { DocumentReadProgress } from "../domain/document-read-progress";
export interface DocumentReadProgressRepository {
  advance(progress: DocumentReadProgress): Promise<void>;
  getMany(
    userId: string,
    workspaceId: string,
    documentIds: string[],
  ): Promise<DocumentReadProgress[]>;
}
