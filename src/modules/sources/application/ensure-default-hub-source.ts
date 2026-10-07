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
 * existing Hub writers. Concurrent first writes serialize on that Workspace row
 * (taken exclusively only to create): the loser re-reads and reuses the winner's Source.
 *
 * Authorized as "content-write" (document.write), not "source-import": the user
 * action is authoring, and Source creation is only incidental (spec §5.4).
 */
function findDefaultHub(sources: readonly { id: string; sourceType: string; status: string; name: string }[]): string | null {
  return sources.find((source) => source.sourceType === "HUB" && source.status === "ACTIVE" && source.name === DEFAULT_HUB_SOURCE_NAME)?.id ?? null;
}

/**
 * Runs on every "New document" and on "New folder" without a Source, so its common
 * case — the Hub Source already exists — must not take the Workspace exclusively:
 * behind a long import Apply that would wait out the lock timeout, and while queued
 * it would also hold back every other writer in the Workspace (a pending FOR UPDATE
 * blocks new LOCK IN SHARE MODE requests). So it first looks under the shared lock,
 * like any writer, and only when the Source is missing takes the Workspace FOR UPDATE
 * in a second transaction, re-checks and inserts: no unique key backs that
 * check-then-insert (workspace shared write lock design).
 */
export async function ensureDefaultHubSource(
  unitOfWork: SourceUnitOfWork,
  caller: CallerContext,
  workspaceId: string,
): Promise<string> {
  const existing = await unitOfWork.run(async (repositories) => {
    await repositories.users.upsertIdentity(caller.identity);
    await lockWorkspaceForMutation(repositories, caller, workspaceId, "content-write");
    return findDefaultHub(await repositories.sourcePolicy.listByWorkspaceId(workspaceId));
  });
  if (existing) return existing;

  return unitOfWork.run(async (repositories) => {
    await lockWorkspaceForMutation(repositories, caller, workspaceId, "content-write", { exclusive: true });
    const created = findDefaultHub(await repositories.sourcePolicy.listByWorkspaceId(workspaceId));
    if (created) return created;
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
