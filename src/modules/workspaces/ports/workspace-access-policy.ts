import type { CallerContext } from "@/modules/identity/domain/caller-context";

export interface WorkspaceAccessPolicy {
  requireMembership(caller: CallerContext, workspaceId: string): Promise<void>;
}
