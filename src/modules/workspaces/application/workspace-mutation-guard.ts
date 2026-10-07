import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { WorkspaceAccessDeniedError, WorkspaceNotFoundError } from "../domain/errors";
import { evaluateWorkspaceCapabilities } from "./workspace-authorization";
import type { WorkspaceGroupMappingRepository } from "../ports/workspace-group-mapping-repository";
import type { Workspace } from "../domain/workspace";
import type { WorkspaceAccessPolicy } from "../ports/workspace-access-policy";
import type { WorkspaceMembershipRepository } from "../ports/workspace-membership-repository";
import type { WorkspaceRepository } from "../ports/workspace-repository";
import { assertTeamMutationAllowed, type TeamMutationOperation } from "./team-workspace-service";

export type WorkspaceMutationRepositories = {
  workspaces: WorkspaceRepository;
  workspaceAccess: WorkspaceAccessPolicy;
  workspaceMemberships: WorkspaceMembershipRepository;
  groupMappings: WorkspaceGroupMappingRepository;
};

/**
 * Spec §14.2 parent-Workspace serialization for content/import writers, as
 * amended by the workspace shared write lock design: writers hold the
 * Workspace row LOCK IN SHARE MODE, so they do not queue behind one another
 * (a folder Apply holds it for its whole transaction), while archive,
 * restore, rename and membership changes take FOR UPDATE and still wait for
 * every writer. Pass `exclusive` for a writer whose check-then-insert has no
 * unique key behind it. Lifecycle is revalidated on the locked row (archive
 * wins: no post-archive commit), then membership on the same connection. Callers must acquire Snapshot/Source locks
 * first so the global order stays Snapshot → Source → Workspace → deeper.
 *
 * The membership gate deliberately keeps the Phase 1 error contract
 * (WorkspaceAccessDeniedError for revoked membership); the Phase 3
 * 404/403 read gate (requireWorkspaceRead) is adopted by Task 12 alongside
 * its admin API contracts, not by writers here.
 *
 * Write capabilities are the union of current direct and trusted-group grants.
 * Both are re-read under the parent lock; VIEWER-only and NULL/legacy grants
 * never authorize writes.
 */
export async function lockWorkspaceForMutation(
  repositories: WorkspaceMutationRepositories,
  caller: CallerContext,
  workspaceId: string,
  operation: TeamMutationOperation,
  options: { exclusive?: boolean } = {},
): Promise<Workspace> {
  const writer = operation === "content-write" || operation === "source-import";
  const locked = writer && !options.exclusive
    ? await repositories.workspaces.lockSharedById(workspaceId)
    : await repositories.workspaces.lockById(workspaceId);
  if (!locked) throw new WorkspaceNotFoundError();
  assertTeamMutationAllowed(locked, operation);
  await repositories.workspaceAccess.requireMembership(caller, workspaceId);
  if (operation === "content-write" || operation === "source-import") {
    await requireWriteCapability(repositories, caller, workspaceId, operation);
  }
  return locked;
}

async function requireWriteCapability(
  repositories: WorkspaceMutationRepositories,
  caller: CallerContext,
  workspaceId: string,
  operation: "content-write" | "source-import",
): Promise<void> {
  const capabilities = await evaluateWorkspaceCapabilities(repositories, caller, workspaceId);
  const required = operation === "source-import" ? "source.manage" : "document.write";
  if (!capabilities.has(required)) {
    throw new WorkspaceAccessDeniedError(`Workspace ${operation} requires ${required}.`);
  }
}
