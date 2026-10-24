import { expect, it, vi } from "vitest";
import { GetSyncRunDetailService } from "@/modules/sources/application/get-sync-run-detail";
import type {
  SourceRepositories,
  SourceUnitOfWork,
} from "@/modules/sources/ports/unit-of-work";
import type { SyncRunChange } from "@/modules/sources/domain/sync-run-change";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";

const WORKSPACE_ID = "0199fb00-0000-7000-8000-000000000001";
const SOURCE_ID = "0199fb00-0000-7000-8000-000000000002";
const RUN_ID = "0199fb00-0000-7000-8000-000000000003";
const DOCUMENT_ID = "0199fb00-0000-7000-8000-000000000004";
const MISSING_REVISION_ID = "missing-revision";
const now = new Date("2026-09-02T00:00:00Z");

const caller = callerFromIdentity({
  id: "0199f000-0000-7000-8000-000000000011",
  emp_id: "FIXTURE-0011",
  name: "Fixture User",
  org_code: "FIXTURE",
});

const change: SyncRunChange = {
  id: "0199fb00-0000-7000-8000-000000000005",
  runId: RUN_ID,
  sourceId: SOURCE_ID,
  workspaceId: WORKSPACE_ID,
  ordinal: 1,
  kind: "DOCUMENT",
  labels: ["UPDATED"],
  sourcePath: "docs/missing.md",
  previousPath: null,
  title: "Missing revision",
  documentId: DOCUMENT_ID,
  beforeRevisionId: MISSING_REVISION_ID,
  afterRevisionId: null,
  beforeRevisionNo: 1,
  afterRevisionNo: 2,
  diagnostics: [],
};

/**
 * The fake `findByIds` returns no rows, so `Map.get()` misses the referenced
 * revision and the service must coerce `undefined` to `null`. A DB-backed test
 * cannot seed this state because `sync_run_changes.before_revision_id` has a
 * foreign key.
 */
function fakeUnitOfWork() {
  const findByIds = vi.fn(async () => []);
  const repositories = {
    workspaceAccess: { requireWorkspaceRead: vi.fn(async () => {}) },
    workspaces: {
      findById: vi.fn(async () => ({
        id: WORKSPACE_ID,
        name: "Fixture Workspace",
        workspaceType: "TEAM" as const,
        lifecycleState: "ACTIVE" as const,
        createdAt: now,
        updatedAt: now,
      })),
    },
    sources: {
      findById: vi.fn(async () => ({
        id: SOURCE_ID,
        name: "Fixture Source",
        workspaceId: WORKSPACE_ID,
        sourceType: "FOLDER_SYNC" as const,
        ownership: "SOURCE_MANAGED" as const,
        status: "ACTIVE" as const,
        syncVersion: 1,
        createdBy: caller.identity.id,
        updatedBy: caller.identity.id,
        archivedBy: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      })),
    },
    syncRuns: {
      findById: vi.fn(async () => ({
        id: RUN_ID,
        sourceId: SOURCE_ID,
        triggeredBy: caller.identity.id,
        basedOnVersion: 1,
        resultVersion: 2,
        status: "APPLIED" as const,
        summary: {},
        startedAt: now,
        completedAt: now,
      })),
    },
    syncRunChanges: {
      listByRun: vi.fn(async (_runId: string, _after: number, limit: number) =>
        limit === 1 ? [] : [change],
      ),
    },
    revisions: { findByIds },
  } as unknown as SourceRepositories;
  const uow = {
    run: async <T>(work: (r: SourceRepositories) => Promise<T>): Promise<T> =>
      work(repositories),
    runWithCreatorQuotaLock: async <T>(
      _creatorId: string,
      _timeout: number,
      work: (r: SourceRepositories) => Promise<T>,
    ): Promise<T> => work(repositories),
  } as SourceUnitOfWork;
  return { uow, repositories, findByIds };
}

it("marks a change unavailable when findByIds omits its referenced revision", async () => {
  const { uow, findByIds } = fakeUnitOfWork();

  const detail = await new GetSyncRunDetailService(uow).get(
    caller,
    WORKSPACE_ID,
    SOURCE_ID,
    RUN_ID,
  );

  expect(findByIds).toHaveBeenCalledTimes(1);
  expect(findByIds).toHaveBeenCalledWith([MISSING_REVISION_ID]);
  expect(detail.changes[0]).toMatchObject({
    revisionUnavailable: true,
    href: null,
    diff: null,
  });
});
