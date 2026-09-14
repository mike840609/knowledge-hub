import type { WorkspaceMembership, WorkspaceMembershipInsert } from "../domain/workspace-membership";

export interface WorkspaceMembershipRepository {
  find(workspaceId: string, userId: string): Promise<WorkspaceMembership | null>;
  insert(membership: WorkspaceMembershipInsert): Promise<void>;
  /** Number of role=OWNER + membership_source=DIRECT rows (governance guard for owner removal). */
  countDirectOwners(workspaceId: string): Promise<number>;
}
