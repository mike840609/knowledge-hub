import type { WorkspaceMembership, WorkspaceMembershipInsert, WorkspaceRole } from "../domain/workspace-membership";

export interface WorkspaceMembershipRepository {
  find(workspaceId: string, userId: string): Promise<WorkspaceMembership | null>;
  insert(membership: WorkspaceMembershipInsert): Promise<void>;
  /** Number of role=OWNER + membership_source=DIRECT rows (governance guard for owner removal). */
  countDirectOwners(workspaceId: string): Promise<number>;
  /** System recovery only: promote an existing direct row to a new role. */
  updateRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>;
  /** Ordinary governance removal of a direct membership row. */
  remove(workspaceId: string, userId: string): Promise<void>;
}
