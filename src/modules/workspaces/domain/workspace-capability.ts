import type { WorkspaceRole } from "./workspace-membership";

export type { WorkspaceRole } from "./workspace-membership";

/**
 * Fixed Phase 3 Workspace-scoped capabilities (spec §9). Discover vs read
 * keeps the 404/403 distinction (spec §12): without discover the resource
 * is hidden (404); with discover but without read it is forbidden (403).
 */
export type WorkspaceCapability =
  | "workspace.discover"
  | "source.discover"
  | "document.discover"
  | "document.read"
  | "document.write"
  | "source.manage"
  | "membership.manage_basic"
  | "membership.manage_admin"
  | "membership.manage_owner"
  | "workspace.rename"
  | "workspace.archive"
  | "workspace.restore"
  | "audit.read";

/**
 * Assignable roles, exactly OWNER | ADMIN | EDITOR | VIEWER (spec §9).
 * There is no assignable DISCOVERER.
 */
export const ASSIGNABLE_WORKSPACE_ROLES: readonly WorkspaceRole[] = [
  "OWNER",
  "ADMIN",
  "EDITOR",
  "VIEWER",
] as const;

/** SSO Group mappings may grant at most ADMIN, never OWNER (spec §8.4). */
export const GROUP_ASSIGNABLE_WORKSPACE_ROLES: readonly WorkspaceRole[] = [
  "ADMIN",
  "EDITOR",
  "VIEWER",
] as const;

const VIEWER_CAPABILITIES: readonly WorkspaceCapability[] = [
  "workspace.discover",
  "source.discover",
  "document.discover",
  "document.read",
];

const EDITOR_CAPABILITIES: readonly WorkspaceCapability[] = [
  ...VIEWER_CAPABILITIES,
  "document.write",
  "source.manage",
];

const ADMIN_CAPABILITIES: readonly WorkspaceCapability[] = [
  ...EDITOR_CAPABILITIES,
  "membership.manage_basic",
  "audit.read",
];

const OWNER_CAPABILITIES: readonly WorkspaceCapability[] = [
  ...ADMIN_CAPABILITIES,
  "membership.manage_admin",
  "membership.manage_owner",
  "workspace.rename",
  "workspace.archive",
  "workspace.restore",
];

/**
 * Fixed capability bundles (spec §9):
 * OWNER = all; ADMIN = discover/read/write + source.manage +
 * membership.manage_basic + audit.read; EDITOR = discover/read/write +
 * source.manage; VIEWER = discover/read.
 */
export const ROLE_WORKSPACE_CAPABILITIES: Record<WorkspaceRole, readonly WorkspaceCapability[]> = {
  VIEWER: VIEWER_CAPABILITIES,
  EDITOR: EDITOR_CAPABILITIES,
  ADMIN: ADMIN_CAPABILITIES,
  OWNER: OWNER_CAPABILITIES,
};
