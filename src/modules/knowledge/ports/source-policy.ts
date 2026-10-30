import type { SourcePolicy } from "../domain/source-policy";

export interface SourcePolicyPort {
  findById(sourceId: string): Promise<SourcePolicy | null>;
  lockById(sourceId: string): Promise<SourcePolicy | null>;
  listByWorkspaceId(workspaceId: string, options?: { includeArchived?: boolean }): Promise<SourcePolicy[]>;
  /**
   * Read-only publication metadata for a team document: its creator, its
   * publication and its publication-relative path. Answered by the sources
   * adapter so Knowledge never imports sources.
   */
  findPublicationDocument(documentId: string): Promise<{ creatorUserId: string; publicationId: string; sourcePath: string | null } | null>;
}
