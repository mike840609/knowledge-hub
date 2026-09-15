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
  /**
   * The caller's My Space by owner (spec §4.1). Requires migration 008;
   * implementations fail with a migration error when the governance
   * columns do not exist yet. Authorization never matches on the name.
   */
  findPersonalByOwnerUserId(ownerUserId: string): Promise<Workspace | null>;
  /**
   * Rename a Team workspace. Callers must hold the row FOR UPDATE and pass
   * the revalidated lifecycle/authorization checks before calling.
   */
  renameWorkspace(workspaceId: string, name: string, updatedAt: Date): Promise<void>;
  /**
   * Apply a Team lifecycle transition. Callers must hold the row FOR UPDATE
   * and pass the revalidated lifecycle/authorization checks before calling.
   */
  setWorkspaceLifecycle(
    workspaceId: string,
    state: "ACTIVE" | "ARCHIVED",
    archivedBy: string | null,
    archivedAt: Date | null,
    updatedAt: Date,
  ): Promise<void>;
}
