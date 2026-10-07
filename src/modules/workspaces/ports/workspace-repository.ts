import type { Workspace, WorkspaceInsert } from "../domain/workspace";

export interface WorkspaceRepository {
  findById(workspaceId: string): Promise<Workspace | null>;
  listForUser(userId: string): Promise<Workspace[]>;
  /**
   * The Workspace row FOR UPDATE: governance (archive/restore, rename, member and
   * group changes) and a writer's create-if-missing step. Content and import
   * writers take lockSharedById instead (workspace shared write lock design);
   * either way the caller revalidates lifecycle/capability on the locked row.
   */
  lockById(workspaceId: string): Promise<Workspace | null>;
  /**
   * The same row LOCK IN SHARE MODE (workspace shared write lock design).
   * Content and import writers hold it so they do not queue behind one
   * another, while governance's FOR UPDATE still waits for every writer.
   */
  lockSharedById(workspaceId: string): Promise<Workspace | null>;
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
