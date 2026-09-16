import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { lockWorkspaceForMutation } from "@/modules/workspaces/application/workspace-mutation-guard";
import { uuidv7 } from "@/shared/ids/uuidv7";
import type { SourceUnitOfWork } from "../ports/unit-of-work";

export const DEFAULT_HUB_SOURCE_NAME = "Notes";

/**
 * Spec §5: every Workspace gets one lazily-created Hub Source so that authoring
 * has somewhere to put a first document.
 *
 * Runs in its own transaction on purpose (spec §5.2). The global lock order is
 * Source → Workspace, but there is no Source to lock yet, so this path takes the
 * Workspace lock alone and never holds both — no deadlock cycle with the four
 * existing Hub writers. Concurrent first writes serialize on that Workspace row:
 * the loser re-reads and reuses the winner's Source.
 *
 * Authorized as "content-write" (document.write), not "source-import": the user
 * action is authoring, and Source creation is only incidental (spec §5.4).
 */
export async function ensureDefaultHubSource(
  unitOfWork: SourceUnitOfWork,
  caller: CallerContext,
  workspaceId: string,
): Promise<string> {
  return unitOfWork.run(async (repositories) => {
    await repositories.users.upsertIdentity(caller.identity);
    await lockWorkspaceForMutation(repositories, caller, workspaceId, "content-write");
    const existing = (await repositories.sourcePolicy.listByWorkspaceId(workspaceId))
      .find((source) => source.sourceType === "HUB" && source.status === "ACTIVE" && source.name === DEFAULT_HUB_SOURCE_NAME);
    if (existing) return existing.id;
    const now = new Date();
    const id = uuidv7();
    await repositories.sources.insert({
      id, name: DEFAULT_HUB_SOURCE_NAME, workspaceId, sourceType: "HUB", ownership: "HUB_MANAGED",
      status: "ACTIVE", syncVersion: 0, createdBy: caller.identity.id, updatedBy: caller.identity.id,
      archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
    });
    return id;
  });
}
