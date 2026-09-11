import type { KnowledgeSource } from "../domain/source";

export interface SourceRepository {
  findById(sourceId: string): Promise<KnowledgeSource | null>;
  /** Workspace-scoped listing. ACTIVE-only unless `{ includeArchived: true }`. */
  findByWorkspaceId(workspaceId: string, options?: { includeArchived?: boolean }): Promise<KnowledgeSource[]>;
  findActiveByWorkspaceId(workspaceId: string): Promise<KnowledgeSource[]>;
  lockById(sourceId: string): Promise<KnowledgeSource | null>;
  insert(source: KnowledgeSource): Promise<void>;
  updateStatus(sourceId: string, status: "ACTIVE" | "ARCHIVED", actorId: string): Promise<void>;
  guardAndAdvanceVersion(sourceId: string, basedOnVersion: number, actorId: string): Promise<number | null>;
}
