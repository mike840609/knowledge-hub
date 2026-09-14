export type WorkspaceRole = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";

export type WorkspaceMembershipSource = "DIRECT" | "SYSTEM_PERSONAL";

export type WorkspaceMembership = {
  workspaceId: string;
  userId: string;
  createdAt: Date;
  /**
   * Nullable through Tasks 1-4: rows written by legacy writers or read
   * before the Team role/owner bootstrap carry NULL until Task 4 backfills
   * them. Canonical write APIs become strict in Task 5.
   */
  role?: WorkspaceRole | null;
  membershipSource?: WorkspaceMembershipSource | null;
};
