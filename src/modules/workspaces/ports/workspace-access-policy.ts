import type { CallerContext } from "@/modules/identity/domain/caller-context";

export interface WorkspaceAccessPolicy {
  requireMembership(caller: CallerContext, workspaceId: string): Promise<void>;
  /**
   * Phase 3 visibility enforcement (spec §12): without discover the Workspace
   * is hidden (404); with discover but without read it is forbidden (403).
   * Write paths authorize through this gate after acquiring row locks, so a
   * revoked membership revalidates to 404/403 instead of a stale allow.
   */
  requireWorkspaceRead(caller: CallerContext, workspaceId: string): Promise<void>;
}
