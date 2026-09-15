/**
 * Enterprise SSO group grant onto a TEAM Workspace.
 *
 * Group mappings are TEAM-only and can never grant OWNER (DB CHECK +
 * application governance). `externalGroupId` is an opaque provider-issued
 * identifier compared by exact bytes; the Hub never materializes
 * user <-> external_group membership truth.
 */
export type WorkspaceGroupRole = "ADMIN" | "EDITOR" | "VIEWER";

export type WorkspaceGroupMapping = {
  id: string;
  workspaceId: string;
  externalGroupId: string;
  role: WorkspaceGroupRole;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};
