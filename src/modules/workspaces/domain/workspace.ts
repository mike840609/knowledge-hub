export type WorkspaceType = "PERSONAL" | "TEAM";

export type WorkspaceLifecycleState = "ACTIVE" | "ARCHIVED";

export type Workspace = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Phase 3 governance fields. Nullable on reads through migration 008 so
   * pre-bootstrap/legacy rows keep loading; canonical write APIs are strict
   * from Task 5 onward (see WorkspaceInsert) and migration 009 finalizes
   * NOT NULL.
   */
  workspaceType?: WorkspaceType | null;
  personalOwnerUserId?: string | null;
  lifecycleState?: WorkspaceLifecycleState | null;
  createdBy?: string | null;
  archivedBy?: string | null;
  archivedAt?: Date | null;
};

/**
 * Canonical application write contract (Task 5). Every application Workspace
 * insert must state its governance explicitly — ordinary code can no longer
 * produce the NULL states that migration 009 will forbid. Raw-SQL NULL
 * inserts remain possible only in controlled bootstrap/legacy tests.
 */
export type WorkspaceInsert = {
  id: string;
  name: string;
  workspaceType: WorkspaceType;
  personalOwnerUserId: string | null;
  lifecycleState: WorkspaceLifecycleState;
  createdBy: string | null;
  archivedBy: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** TEAM workspaces are never personally owned and start ACTIVE. */
export function createTeamWorkspaceInsert(options: { id: string; name: string; createdBy: string | null; now: Date }): WorkspaceInsert {
  return {
    id: options.id,
    name: options.name,
    workspaceType: "TEAM",
    personalOwnerUserId: null,
    lifecycleState: "ACTIVE",
    createdBy: options.createdBy,
    archivedBy: null,
    archivedAt: null,
    createdAt: options.now,
    updatedAt: options.now,
  };
}

/** PERSONAL workspaces are pinned to exactly one owner user and start ACTIVE. */
export function createPersonalWorkspaceInsert(options: { id: string; name: string; ownerUserId: string; now: Date }): WorkspaceInsert {
  return {
    id: options.id,
    name: options.name,
    workspaceType: "PERSONAL",
    personalOwnerUserId: options.ownerUserId,
    lifecycleState: "ACTIVE",
    createdBy: options.ownerUserId,
    archivedBy: null,
    archivedAt: null,
    createdAt: options.now,
    updatedAt: options.now,
  };
}
