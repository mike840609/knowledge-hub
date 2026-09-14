export type WorkspaceType = "PERSONAL" | "TEAM";

export type WorkspaceLifecycleState = "ACTIVE" | "ARCHIVED";

export type Workspace = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Phase 3 governance fields. Optional + nullable through Tasks 1-4 so
   * pre-bootstrap reads and legacy writers keep compiling; canonical write
   * APIs become strict in Task 5 and migration 009 finalizes NOT NULL.
   */
  workspaceType?: WorkspaceType | null;
  personalOwnerUserId?: string | null;
  lifecycleState?: WorkspaceLifecycleState | null;
  createdBy?: string | null;
  archivedBy?: string | null;
  archivedAt?: Date | null;
};
