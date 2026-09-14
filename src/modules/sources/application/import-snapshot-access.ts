import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { importError } from "@/modules/sources/domain/import-errors";
import { WorkspaceAccessDeniedError, WorkspaceNotFoundError } from "@/modules/workspaces/domain/errors";
import type { WorkspaceAccessPolicy } from "@/modules/workspaces/ports/workspace-access-policy";

export function translateKnownSnapshotAccessError(error: unknown): unknown {
  if (error instanceof WorkspaceAccessDeniedError || error instanceof WorkspaceNotFoundError) {
    return importError(
      "IMPORT_SNAPSHOT_ACCESS_DENIED",
      "Import snapshot exists, but you no longer have access to its Workspace.",
    );
  }
  return error;
}

/**
 * The caller has already passed the creator-private snapshot check before this
 * helper is called, so the snapshot's existence is discoverable to that caller.
 * A revoked Workspace membership collapses to the explicit known-resource
 * denial (never a bare 404/403 that would confuse the import flow); every
 * other policy failure keeps its original semantics.
 */
export async function requireKnownSnapshotWorkspaceAccess(
  policy: WorkspaceAccessPolicy,
  caller: CallerContext,
  workspaceId: string,
): Promise<void> {
  try {
    await policy.requireMembership(caller, workspaceId);
  } catch (error) {
    throw translateKnownSnapshotAccessError(error);
  }
}

/**
 * Phase 3 §12 read gate for known snapshots: discover without read is
 * forbidden (403), no discover is hidden (404) — both collapse to the
 * known-resource denial above once the creator check has passed.
 */
export async function requireKnownSnapshotWorkspaceRead(
  policy: WorkspaceAccessPolicy,
  caller: CallerContext,
  workspaceId: string,
): Promise<void> {
  try {
    await policy.requireWorkspaceRead(caller, workspaceId);
  } catch (error) {
    throw translateKnownSnapshotAccessError(error);
  }
}
