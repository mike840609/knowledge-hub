import { describe, expect, it, vi } from "vitest";
import { ListFolderUpdatesService } from "@/modules/personal/application/list-folder-updates";
import type { SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";
import type { SyncRun } from "@/modules/sources/domain/sync-run";
import type { SyncRunChange } from "@/modules/sources/domain/sync-run-change";
import type { CallerContext } from "@/modules/identity/domain/caller-context";

const WORKSPACE_ID = "0199f400-0000-7000-8000-0000000007a1";
const CALLER_ID = "0199f400-0000-7000-8000-0000000007a2";
const SOURCE_A = "0199f400-0000-7000-8000-0000000007a3";
const SOURCE_B = "0199f400-0000-7000-8000-0000000007a4";

const caller: CallerContext = {
  identity: { id: CALLER_ID, emp_id: "e", name: "Caller", org_code: "TEST" },
  validatedExternalGroupIds: [],
  platformCapabilities: [],
};

function run(id: string, sourceId: string, completedAt: Date): SyncRun {
  return {
    id,
    sourceId,
    triggeredBy: CALLER_ID,
    basedOnVersion: 1,
    resultVersion: 2,
    status: "APPLIED",
    summary: {},
    startedAt: completedAt,
    completedAt,
  };
}

function change(id: string, runId: string, sourceId: string, documentId: string, ordinal: number): SyncRunChange {
  return {
    id,
    runId,
    sourceId,
    workspaceId: WORKSPACE_ID,
    ordinal,
    kind: "DOCUMENT",
    labels: ["UPDATED"],
    sourcePath: `docs/${documentId}.md`,
    previousPath: null,
    title: documentId,
    documentId,
    beforeRevisionId: null,
    afterRevisionId: `rev-${documentId}`,
    beforeRevisionNo: null,
    afterRevisionNo: ordinal,
    diagnostics: [],
  };
}

function fakeUnitOfWork() {
  const now = new Date("2026-10-24T09:00:00Z");
  const runs = [
    run("run-a1", SOURCE_A, new Date(now.getTime() - 1_000)),
    run("run-b1", SOURCE_B, new Date(now.getTime() - 2_000)),
    run("run-a2", SOURCE_A, new Date(now.getTime() - 3_000)),
  ];
  const changesByRun: Record<string, SyncRunChange[]> = {
    "run-a1": [change("c1", "run-a1", SOURCE_A, "doc-1", 1), change("c2", "run-a1", SOURCE_A, "doc-2", 2)],
    "run-b1": [change("c3", "run-b1", SOURCE_B, "doc-3", 1)],
    "run-a2": [change("c4", "run-a2", SOURCE_A, "doc-4", 1)],
  };
  const listByWorkspaceId = vi.fn(async () => [
    { id: SOURCE_A, workspaceId: WORKSPACE_ID, name: "Alpha", sourceType: "FOLDER_SYNC" as const, status: "ACTIVE" as const, ownership: "SOURCE_MANAGED" as const, syncVersion: 3, createdBy: CALLER_ID, updatedBy: CALLER_ID, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now },
    { id: SOURCE_B, workspaceId: WORKSPACE_ID, name: "Beta", sourceType: "FOLDER_SYNC" as const, status: "ACTIVE" as const, ownership: "SOURCE_MANAGED" as const, syncVersion: 3, createdBy: CALLER_ID, updatedBy: CALLER_ID, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now },
  ]);
  const getMany = vi.fn(async () => [{ documentId: "doc-1", revisionNo: 1 }]);
  const repositories = {
    workspaceAccess: { requireWorkspaceRead: vi.fn(async () => {}) },
    workspaces: { findById: vi.fn(async () => ({ id: WORKSPACE_ID, name: "My Space", workspaceType: "PERSONAL", personalOwnerUserId: CALLER_ID, lifecycleState: "ACTIVE" })) },
    syncRunChanges: {
      listAppliedRuns: vi.fn(async () => runs),
      listReadingChanges: vi.fn(async (runId: string) => {
        const changes = changesByRun[runId]!;
        return { changes, total: changes.length, added: 0, updated: changes.length };
      }),
    },
    sourcePolicy: { listByWorkspaceId },
    documentReadProgress: { getMany },
  };
  const uow = { run: async (work: (repositories: unknown) => unknown) => work(repositories) } as unknown as SourceUnitOfWork;
  return { uow, listByWorkspaceId, getMany, listReadingChanges: repositories.syncRunChanges.listReadingChanges, listAppliedRuns: repositories.syncRunChanges.listAppliedRuns };
}

describe("folder updates batching", () => {
  it("reads the source list and read progress once for the whole page", async () => {
    const calls = fakeUnitOfWork();
    const page = await new ListFolderUpdatesService(calls.uow).list(caller, WORKSPACE_ID, { limit: 20 });

    expect(calls.listAppliedRuns).toHaveBeenCalledTimes(1);
    expect(calls.listReadingChanges).toHaveBeenCalledTimes(3);
    expect(calls.listByWorkspaceId).toHaveBeenCalledTimes(1);
    expect(calls.listByWorkspaceId).toHaveBeenCalledWith(WORKSPACE_ID, {});
    expect(calls.getMany).toHaveBeenCalledTimes(1);
    expect(calls.getMany).toHaveBeenCalledWith(CALLER_ID, WORKSPACE_ID, ["doc-1", "doc-2", "doc-3", "doc-4"]);

    expect(page.runs.map((group) => group.sourceName)).toEqual(["Alpha", "Beta", "Alpha"]);
    expect(page.runs.map((group) => group.totalChanges)).toEqual([2, 1, 1]);
    expect(page.runs[0].changes.map((item) => item.unread)).toEqual([false, true]);
  });
});
