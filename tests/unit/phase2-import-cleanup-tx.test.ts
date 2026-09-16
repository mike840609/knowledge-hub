import { describe, expect, it } from "vitest";
import { CleanupFolderImportsService } from "@/modules/sources/application/cleanup-folder-imports";
import type { SourceRepositories, SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";

function stubUow(candidates: string[]): { uow: SourceUnitOfWork; runCalls: number } {
  let runCalls = 0;
  const uow: SourceUnitOfWork = {
    async run<T>(work: (repositories: SourceRepositories) => Promise<T>): Promise<T> {
      runCalls += 1;
      const repositories = {
        importSnapshots: {
          listCleanupCandidates: async () => candidates,
          deleteIfCleanupEligible: async () => true,
        },
      } as unknown as SourceRepositories;
      return work(repositories);
    },
    async runWithCreatorQuotaLock<T>(
      _creatorId: string,
      _timeoutSeconds: number,
      work: (repositories: SourceRepositories) => Promise<T>,
    ): Promise<T> {
      return uow.run(work);
    },
  };
  return {
    uow,
    get runCalls() {
      return runCalls;
    },
  };
}

describe("CleanupFolderImports transaction boundaries", () => {
  it("uses one short list transaction plus one transaction per delete (N+1 run calls)", async () => {
    const candidates = ["snap-1", "snap-2", "snap-3"];
    const stub = stubUow(candidates);
    const service = new CleanupFolderImportsService(stub.uow);

    const result = await service.cleanup({ now: new Date("2026-09-12T12:00:00.000Z") });

    expect(result.deleted).toBe(3);
    expect(stub.runCalls).toBe(candidates.length + 1);
  });

  it("uses exactly one run call when there is nothing to delete", async () => {
    const stub = stubUow([]);
    const service = new CleanupFolderImportsService(stub.uow);

    const result = await service.cleanup({ now: new Date("2026-09-12T12:00:00.000Z") });

    expect(result.deleted).toBe(0);
    expect(stub.runCalls).toBe(1);
  });
});
