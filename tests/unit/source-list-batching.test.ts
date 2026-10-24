import { beforeEach, describe, expect, it, vi } from "vitest";
import type { applicationServices as ApplicationServicesFn } from "@/server/composition";
import type { SyncRun } from "@/modules/sources/domain/sync-run";

vi.mock("@/server/composition", () => ({ applicationServices: vi.fn() }));

import { applicationServices } from "@/server/composition";
import { getSourceListModel } from "@/server/source-read";

type Services = ReturnType<typeof ApplicationServicesFn>;

const WORKSPACE_ID = "0199f400-0000-7000-8000-0000000006a1";
const HUB_SOURCE_ID = "0199f400-0000-7000-8000-0000000006a2";
const FOLDER_SOURCE_ID = "0199f400-0000-7000-8000-0000000006a3";
const CALLER_ID = "0199f400-0000-7000-8000-0000000006a4";
const SNAPSHOT_ID = "0199f400-0000-7000-8000-0000000006a5";
const LATEST_RUN_ID = "0199f400-0000-7000-8000-0000000006a6";
const APPLIED_RUN_ID = "0199f400-0000-7000-8000-0000000006a7";

const now = new Date("2026-10-24T09:00:00Z");

function run(id: string, sourceId: string, status: SyncRun["status"]): SyncRun {
  return {
    id,
    sourceId,
    triggeredBy: CALLER_ID,
    basedOnVersion: 3,
    resultVersion: status === "APPLIED" ? 4 : null,
    status,
    summary: {},
    startedAt: now,
    completedAt: status === "APPLIED" ? now : null,
  };
}

/**
 * The source list runs one unit of work with three batch reads. The fake
 * records every repository call so the test can pin the call count, and keeps
 * the removed per-source methods wired to spies that must stay untouched.
 */
function fakeServices() {
  const listLatestBySourceIds = vi.fn(async () => [run(LATEST_RUN_ID, FOLDER_SOURCE_ID, "FAILED")]);
  const listLatestAppliedBySourceIds = vi.fn(async () => [run(APPLIED_RUN_ID, FOLDER_SOURCE_ID, "APPLIED")]);
  const findLatestReadyIdsBySourceForCreator = vi.fn(async () => new Map([[FOLDER_SOURCE_ID, SNAPSHOT_ID]]));
  const listBySourceId = vi.fn(async () => {
    throw new Error("listBySourceId must not be called by the source list");
  });
  const findLatestReadyIdBySourceForCreator = vi.fn(async () => {
    throw new Error("findLatestReadyIdBySourceForCreator must not be called by the source list");
  });
  const repositories = { syncRuns: { listLatestBySourceIds, listLatestAppliedBySourceIds, listBySourceId }, importSnapshots: { findLatestReadyIdsBySourceForCreator, findLatestReadyIdBySourceForCreator } };
  const services = {
    establishTrustedCaller: vi.fn(async () => ({ caller: { identity: { id: CALLER_ID } } })),
    workspaces: { listWorkspaces: vi.fn(async () => [{ id: WORKSPACE_ID }]) },
    workspaceAdmin: { workspaceState: vi.fn(async () => ({ actions: { canInspectSources: true } })) },
    queries: {
      listSources: vi.fn(async () => [
        { id: FOLDER_SOURCE_ID, workspaceId: WORKSPACE_ID, name: "Folder", sourceType: "FOLDER_SYNC", status: "ACTIVE", ownership: "SOURCE_MANAGED", syncVersion: 3 },
        { id: HUB_SOURCE_ID, workspaceId: WORKSPACE_ID, name: "Hub", sourceType: "HUB", status: "ACTIVE", ownership: "HUB_MANAGED", syncVersion: 0 },
      ]),
    },
    unitOfWork: { run: vi.fn(async (work: (repositories: unknown) => unknown) => work(repositories)) },
  } as unknown as Services;
  vi.mocked(applicationServices).mockReturnValue(services);
  return { listLatestBySourceIds, listLatestAppliedBySourceIds, findLatestReadyIdsBySourceForCreator, listBySourceId, findLatestReadyIdBySourceForCreator };
}

describe("source list batch reads", () => {
  beforeEach(() => vi.mocked(applicationServices).mockReset());

  it("reads all sources with three batch calls and never per source", async () => {
    const calls = fakeServices();

    const model = await getSourceListModel(WORKSPACE_ID);
    expect(model).not.toBeNull();
    expect(model!.items.map((item) => item.source.id)).toEqual([FOLDER_SOURCE_ID, HUB_SOURCE_ID]);
    const items = new Map(model!.items.map((item) => [item.source.id, item]));

    expect(items.get(FOLDER_SOURCE_ID)).toMatchObject({
      latestRun: { id: LATEST_RUN_ID },
      latestSuccessfulRun: { id: APPLIED_RUN_ID },
      pendingPreviewId: SNAPSHOT_ID,
    });

    expect(calls.listLatestBySourceIds).toHaveBeenCalledTimes(1);
    expect(calls.listLatestBySourceIds).toHaveBeenCalledWith([FOLDER_SOURCE_ID, HUB_SOURCE_ID]);
    expect(calls.listLatestAppliedBySourceIds).toHaveBeenCalledTimes(1);
    expect(calls.listLatestAppliedBySourceIds).toHaveBeenCalledWith([FOLDER_SOURCE_ID]);
    expect(calls.findLatestReadyIdsBySourceForCreator).toHaveBeenCalledTimes(1);
    expect(calls.findLatestReadyIdsBySourceForCreator).toHaveBeenCalledWith(
      [{ sourceId: FOLDER_SOURCE_ID, basedOnVersion: 3 }],
      CALLER_ID,
      expect.any(Date),
    );
    expect(calls.listBySourceId).not.toHaveBeenCalled();
    expect(calls.findLatestReadyIdBySourceForCreator).not.toHaveBeenCalled();
  });

  it("leaves a HUB source without a successful run or pending preview", async () => {
    fakeServices();

    const model = await getSourceListModel(WORKSPACE_ID);
    const hub = model!.items.find((item) => item.source.id === HUB_SOURCE_ID);

    expect(hub).toMatchObject({
      latestRun: null,
      latestSuccessfulRun: null,
      pendingPreviewId: null,
    });
  });
});
