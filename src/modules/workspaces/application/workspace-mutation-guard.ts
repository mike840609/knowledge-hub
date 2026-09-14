import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { WorkspaceAccessDeniedError, WorkspaceNotFoundError } from "../domain/errors";
import { ROLE_WORKSPACE_CAPABILITIES } from "../domain/workspace-capability";
import type { Workspace } from "../domain/workspace";
import type { WorkspaceAccessPolicy } from "../ports/workspace-access-policy";
import type { WorkspaceMembershipRepository } from "../ports/workspace-membership-repository";
import type { WorkspaceRepository } from "../ports/workspace-repository";
import { assertTeamMutationAllowed, type TeamMutationOperation } from "./team-workspace-service";

export type WorkspaceMutationRepositories = {
  workspaces: WorkspaceRepository;
  workspaceAccess: WorkspaceAccessPolicy;
  workspaceMemberships: WorkspaceMembershipRepository;
};

/**
 * Spec §14.2 parent-Workspace serialization for content/import writers.
 * Locks the Workspace row FOR UPDATE, revalidates lifecycle on the locked
 * row (archive wins: no post-archive commit), then revalidates membership
 * on the same connection. Callers must acquire Snapshot/Source locks
 * first so the global order stays Snapshot → Source → Workspace → deeper.
 *
 * The membership gate deliberately keeps the Phase 1 error contract
 * (WorkspaceAccessDeniedError for revoked membership); the Phase 3
 * 404/403 read gate (requireWorkspaceRead) is adopted by Task 12 alongside
 * its admin API contracts, not by writers here.
 *
 * Direct-role write gate (spec §9): for `content-write`/`source-import` the
 * caller's direct role must carry the write bundle (OWNER/ADMIN/EDITOR).
 * VIEWER and NULL/legacy rows are denied fail-closed. This is direct-role
 * only: group-union write evaluation follows with the Task 12 principal
 * plumbing — callers here carry a CallerContext whose validated groups are
 * not yet server-resolved for writers, so group grants are never consulted.
 */
export async function lockWorkspaceForMutation(
  repositories: WorkspaceMutationRepositories,
  caller: CallerContext,
  workspaceId: string,
  operation: TeamMutationOperation,
): Promise<Workspace> {
  const locked = await repositories.workspaces.lockById(workspaceId);
  if (!locked) throw new WorkspaceNotFoundError();
  assertTeamMutationAllowed(locked, operation);
  await repositories.workspaceAccess.requireMembership(caller, workspaceId);
  if (operation === "content-write" || operation === "source-import") {
    await requireDirectWriteRole(repositories, caller, workspaceId, operation);
  }
  return locked;
}

async function requireDirectWriteRole(
  repositories: WorkspaceMutationRepositories,
  caller: CallerContext,
  workspaceId: string,
  operation: "content-write" | "source-import",
): Promise<void> {
  const membership = await repositories.workspaceMemberships.find(workspaceId, caller.identity.id);
  const role = membership?.role ?? null;
  if (role === null || !ROLE_WORKSPACE_CAPABILITIES[role].includes("document.write")) {
    throw new WorkspaceAccessDeniedError(
      `Workspace ${operation} requires a direct OWNER, ADMIN, or EDITOR grant; callers with VIEWER or no direct role are read-only.`,
    );
  }
}
