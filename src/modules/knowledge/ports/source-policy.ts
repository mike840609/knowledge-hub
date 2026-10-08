import type { SourcePolicy, StoredImage } from "../domain/source-policy";

export interface SourcePolicyPort {
  findById(sourceId: string): Promise<SourcePolicy | null>;
  lockById(sourceId: string): Promise<SourcePolicy | null>;
  listByWorkspaceId(workspaceId: string, options?: { includeArchived?: boolean }): Promise<SourcePolicy[]>;
  /**
   * The stored image `src` points at, read as the document's Markdown writes it.
   * Looks only in the document's own source. Authorizes nothing: the caller has
   * already decided the reader may see this document.
   */
  findStoredImage(documentId: string, src: string): Promise<StoredImage | null>;
}
