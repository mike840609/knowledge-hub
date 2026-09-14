export type WorkspaceRole = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";

export type WorkspaceMembershipSource = "DIRECT" | "SYSTEM_PERSONAL";

export type WorkspaceMembership = {
  workspaceId: string;
  userId: string;
  createdAt: Date;
  /**
   * Nullable on reads through migration 008: rows written by legacy writers
   * or read before the Team role/owner bootstrap carry NULL until Task 4
   * backfills them. Canonical write APIs are strict from Task 5 onward
   * (see WorkspaceMembershipInsert).
   */
  role?: WorkspaceRole | null;
  membershipSource?: WorkspaceMembershipSource | null;
};

/**
 * Canonical application write contract (Task 5). Every application
 * membership insert must state its role and provenance explicitly —
 * ordinary code can no longer produce the NULL states that migration 009
 * will forbid.
 */
export type WorkspaceMembershipInsert = {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  membershipSource: WorkspaceMembershipSource;
  createdAt: Date;
};

/** Ordinary governance grant onto a workspace (human or group-provisioned). */
export function createDirectMembership(options: { workspaceId: string; userId: string; role: WorkspaceRole; now: Date }): WorkspaceMembershipInsert {
  return {
    workspaceId: options.workspaceId,
    userId: options.userId,
    role: options.role,
    membershipSource: "DIRECT",
    createdAt: options.now,
  };
}

/**
 * System-provisioned PERSONAL workspace ownership. Only the provisioning
 * path writes OWNER + SYSTEM_PERSONAL; group mappings can never grant OWNER.
 */
export function createSystemPersonalMembership(options: { workspaceId: string; userId: string; now: Date }): WorkspaceMembershipInsert {
  return {
    workspaceId: options.workspaceId,
    userId: options.userId,
    role: "OWNER",
    membershipSource: "SYSTEM_PERSONAL",
    createdAt: options.now,
  };
}
