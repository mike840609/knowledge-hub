import type { WorkspaceMembership } from "../domain/workspace-membership";

export interface WorkspaceMembershipRepository {
  find(workspaceId: string, userId: string): Promise<WorkspaceMembership | null>;
  insert(membership: WorkspaceMembership): Promise<void>;
}
