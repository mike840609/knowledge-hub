import type { WorkspaceGroupMapping, WorkspaceGroupRole } from "../domain/workspace-group-mapping";

export interface WorkspaceGroupMappingRepository {
  /** Exact-byte lookup: external_group_id is opaque provider bytes, never normalized. */
  findExact(workspaceId: string, externalGroupId: string): Promise<WorkspaceGroupMapping | null>;
  listByWorkspace(workspaceId: string): Promise<WorkspaceGroupMapping[]>;
  /** All mappings whose external group matches one of the caller's validated IDs (exact bytes). */
  listByExternalGroupIds(externalGroupIds: readonly string[]): Promise<WorkspaceGroupMapping[]>;
  insert(mapping: WorkspaceGroupMapping): Promise<void>;
  /** Ordinary governance role change on an existing mapping row. */
  updateRole(id: string, role: WorkspaceGroupRole): Promise<void>;
  /** Ordinary governance removal of a mapping row. */
  remove(id: string): Promise<void>;
}
