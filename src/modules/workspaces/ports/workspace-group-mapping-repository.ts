import type { WorkspaceGroupMapping } from "../domain/workspace-group-mapping";

export interface WorkspaceGroupMappingRepository {
  /** Exact-byte lookup: external_group_id is opaque provider bytes, never normalized. */
  findExact(workspaceId: string, externalGroupId: string): Promise<WorkspaceGroupMapping | null>;
  listByWorkspace(workspaceId: string): Promise<WorkspaceGroupMapping[]>;
  /** All mappings whose external group matches one of the caller's validated IDs (exact bytes). */
  listByExternalGroupIds(externalGroupIds: readonly string[]): Promise<WorkspaceGroupMapping[]>;
  insert(mapping: WorkspaceGroupMapping): Promise<void>;
}
