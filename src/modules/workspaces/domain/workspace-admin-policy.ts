import { WorkspaceAccessDeniedError, WorkspaceLifecycleError } from "./errors";
import type { WorkspaceRole } from "./workspace-membership";

/**
 * Phase 3 governance authority ceilings (spec §10).
 *
 * Direct memberships: ADMIN may grant/change/remove EDITOR/VIEWER only. Any
 * touch of OWNER or ADMIN — persisted `beforeRole` or requested `afterRole` —
 * requires actor OWNER.
 *
 * SSO group mappings: ADMIN may manage EDITOR/VIEWER only; Group→ADMIN
 * requires actor OWNER. Group mappings can never carry OWNER (DB CHECK +
 * repository guard; rejected here as well in defense in depth).
 *
 * NULL-role rows are never authority (requireDirectOwner pattern): a missing
 * or NULL actor role denies every governance operation.
 */
export type GovernanceActorRole = WorkspaceRole | null | undefined;

export type GovernanceRole = WorkspaceRole | null | undefined;

export type GovernanceTarget = "direct" | "group";

export function assertGovernanceAuthority(input: {
  actorRole: GovernanceActorRole;
  target: GovernanceTarget;
  beforeRole: GovernanceRole;
  afterRole: GovernanceRole;
  operation: string;
}): void {
  if (input.target === "group" && (input.beforeRole === "OWNER" || input.afterRole === "OWNER")) {
    throw new WorkspaceLifecycleError("SSO group mappings can never grant OWNER on a Team workspace.");
  }
  if (input.actorRole !== "OWNER" && input.actorRole !== "ADMIN") {
    throw new WorkspaceAccessDeniedError(
      `Team workspace ${input.operation} requires a direct OWNER or ADMIN grant.`,
    );
  }
  if (input.actorRole === "OWNER") return;
  const touchesAuthority =
    input.target === "direct"
      ? isDirectAuthorityRole(input.beforeRole) || isDirectAuthorityRole(input.afterRole)
      : input.beforeRole === "ADMIN" || input.afterRole === "ADMIN";
  if (touchesAuthority) {
    throw new WorkspaceAccessDeniedError(
      `Team workspace ${input.operation} touches OWNER/ADMIN authority and requires a direct OWNER grant.`,
    );
  }
}

function isDirectAuthorityRole(role: GovernanceRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}
