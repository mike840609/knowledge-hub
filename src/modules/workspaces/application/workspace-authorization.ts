import type { WorkspaceCapability } from "../domain/workspace-capability";
import { ROLE_WORKSPACE_CAPABILITIES } from "../domain/workspace-capability";
import type { WorkspaceRole } from "../domain/workspace-membership";
import { WorkspaceAccessDeniedError, WorkspaceNotFoundError } from "../domain/errors";

/**
 * Phase 3 capability evaluation (spec §11).
 *
 * Effective capabilities are the UNION of the caller's direct role bundle and
 * every matched validated-group role bundle. There is no explicit deny and no
 * direct-vs-group precedence: grants only ever add capabilities.
 *
 * Group evaluation uses ONLY the current caller's server-validated external
 * group IDs with exact-byte matching (spec §8.4). Group grants can never
 * confer OWNER: rows carrying any other role are ignored even if present
 * (defense in depth alongside the DB CHECK and the repository guard).
 */
export type GroupGrantInput = {
  externalGroupId: string;
  role: string;
};

function isGroupGrantableRole(role: string): role is "ADMIN" | "EDITOR" | "VIEWER" {
  return role === "ADMIN" || role === "EDITOR" || role === "VIEWER";
}

function unionRoleCapabilities(target: Set<WorkspaceCapability>, role: WorkspaceRole | "ADMIN" | "EDITOR" | "VIEWER"): void {
  for (const capability of ROLE_WORKSPACE_CAPABILITIES[role]) {
    target.add(capability);
  }
}

export function evaluateEffectiveCapabilities(input: {
  /**
   * Direct membership role. `undefined` means no direct row (no grant).
   * `null` means a pre-bootstrap/legacy row whose role is not yet backfilled:
   * the row proves membership, so it grants the baseline visibility bundle
   * (VIEWER) until the Task 4 backfill assigns its real role. Migration 009
   * forbids NULL roles afterward, closing this window.
   */
  directRole: WorkspaceRole | null | undefined;
  validatedExternalGroupIds: readonly string[];
  groupMappings: readonly GroupGrantInput[];
}): Set<WorkspaceCapability> {
  const effective = new Set<WorkspaceCapability>();
  if (input.directRole === null) {
    unionRoleCapabilities(effective, "VIEWER");
  } else if (input.directRole !== undefined) {
    unionRoleCapabilities(effective, input.directRole);
  }
  const validated = new Set(input.validatedExternalGroupIds);
  for (const mapping of input.groupMappings) {
    if (!validated.has(mapping.externalGroupId)) continue;
    if (!isGroupGrantableRole(mapping.role)) continue;
    unionRoleCapabilities(effective, mapping.role);
  }
  return effective;
}

/**
 * Visibility enforcement (spec §12): without discover the Workspace is hidden
 * (404); with discover but without read it is forbidden (403). All four
 * assignable roles currently contain read, so the 403 branch is reserved for
 * future finer-grained grants — never remove it.
 */
export function requireWorkspaceDiscover(capabilities: ReadonlySet<WorkspaceCapability>): void {
  if (!capabilities.has("workspace.discover")) {
    throw new WorkspaceNotFoundError();
  }
}

export function requireWorkspaceRead(capabilities: ReadonlySet<WorkspaceCapability>): void {
  requireWorkspaceDiscover(capabilities);
  if (!capabilities.has("document.read")) {
    throw new WorkspaceAccessDeniedError();
  }
}

/**
 * Other-user access reporting (spec §11): Phase 3 only ever computes
 * group-derived effective access for the current caller. For any other user
 * the direct role is shown alongside UNKNOWN_NOT_EVALUATED — an unknown group
 * set must never be fabricated into an empty (or any) computed grant.
 */
export const OTHER_USER_GROUP_ACCESS_UNKNOWN = "UNKNOWN_NOT_EVALUATED" as const;

export type OtherUserAccess = {
  directRole: WorkspaceRole | null;
  groupEffectiveAccess: typeof OTHER_USER_GROUP_ACCESS_UNKNOWN;
};

export function describeOtherUserAccess(directRole: WorkspaceRole | null | undefined): OtherUserAccess {
  return { directRole: directRole ?? null, groupEffectiveAccess: OTHER_USER_GROUP_ACCESS_UNKNOWN };
}
