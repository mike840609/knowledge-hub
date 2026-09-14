import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { importError } from "@/modules/sources/domain/import-errors";
import { WorkspaceAccessDeniedError } from "@/modules/workspaces/domain/errors";
import type { WorkspaceAccessPolicy } from "@/modules/workspaces/ports/workspace-access-policy";

/**
 * The caller has already passed the creator-private snapshot check before this
 * helper is called, so the snapshot's existence is discoverable to that caller.
 * Translate only a revoked Workspace membership into an explicit known-resource
 * denial; every other policy failure keeps its original semantics.
 */
export async function requireKnownSnapshotWorkspaceAccess(
  policy: WorkspaceAccessPolicy,
  caller: CallerContext,
  workspaceId: string,
): Promise<void> {
  try {
    await policy.requireMembership(caller, workspaceId);
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) {
      throw importError(
        "IMPORT_SNAPSHOT_ACCESS_DENIED",
        "Import snapshot exists, but you no longer have access to its Workspace.",
      );
    }
    throw error;
  }
}
