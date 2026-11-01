import type { SourceEntry } from "../domain/source-entry";

export interface EntryRepository {
  findByDocumentIds(documentIds:string[]):Promise<SourceEntry[]>;
  countActiveDocuments(sourceId: string): Promise<number>;
  findBySourcePath(sourceId: string, sourcePath: string): Promise<SourceEntry | null>;
  findById(entryId: string): Promise<SourceEntry | null>;
  findByExternalId(sourceId: string, externalId: string): Promise<SourceEntry | null>;
  findByDocumentId(documentId: string): Promise<SourceEntry | null>;
  findByTreeNodeId(treeNodeId: string): Promise<SourceEntry | null>;
  /**
   * The path a document is placed at, whichever table keeps it. A publication
   * copy has no `source_entries` row: its publication-relative path lives in
   * `publication_documents`, and `NULL` there stays `NULL`. Read-only: this is
   * never an identity for a write.
   */
  findSourcePathByDocumentId(documentId: string): Promise<string | null>;
  insert(entry: SourceEntry): Promise<void>;
  insertMany(entries: readonly SourceEntry[]): Promise<void>;
  update(entry: SourceEntry): Promise<void>;
}
