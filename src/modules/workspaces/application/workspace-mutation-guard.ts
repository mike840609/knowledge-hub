import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { WorkspaceNotFoundError } from "../domain/errors";
import type { Workspace } from "../domain/workspace";
import type { WorkspaceAccessPolicy } from "../ports/workspace-access-policy";
import type { WorkspaceRepository } from "../ports/workspace-repository";
import { assertTeamMutationAllowed, type TeamMutationOperation } from "./team-workspace-service";

export type WorkspaceMutationRepositories = {
  workspaces: WorkspaceRepository;
  workspaceAccess: WorkspaceAccessPolicy;
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
  return locked;
}
