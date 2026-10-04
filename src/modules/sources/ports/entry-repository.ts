import type { SourceEntry } from "../domain/source-entry";

export interface EntryRepository {
  findByDocumentIds(documentIds:string[]):Promise<SourceEntry[]>;
  countActiveDocuments(sourceId: string): Promise<number>;
  findBySourcePath(sourceId: string, sourcePath: string): Promise<SourceEntry | null>;
  findById(entryId: string): Promise<SourceEntry | null>;
  findByExternalId(sourceId: string, externalId: string): Promise<SourceEntry | null>;
  findByDocumentId(documentId: string): Promise<SourceEntry | null>;
  findByTreeNodeId(treeNodeId: string): Promise<SourceEntry | null>;
  insert(entry: SourceEntry): Promise<void>;
  update(entry: SourceEntry): Promise<void>;
}
