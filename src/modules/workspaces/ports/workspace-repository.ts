import type { Workspace, WorkspaceInsert } from "../domain/workspace";

export interface WorkspaceRepository {
  findById(workspaceId: string): Promise<Workspace | null>;
  listForUser(userId: string): Promise<Workspace[]>;
  /**
   * Spec §14.2: every Workspace-scoped mutation must hold the parent
   * Workspace row FOR UPDATE before mutating, then revalidate
   * lifecycle/capability on the locked row.
   */
  lockById(workspaceId: string): Promise<Workspace | null>;
  insert(workspace: WorkspaceInsert): Promise<void>;
}
