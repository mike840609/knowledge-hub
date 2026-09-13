import type { SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";

type Options = { now?: () => Date; batchSize?: number };

const DEFAULT_BATCH_SIZE = 200;
const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 500;

function clampBatchSize(value: number): number {
  if (!Number.isInteger(value)) return DEFAULT_BATCH_SIZE;
  return Math.min(MAX_BATCH_SIZE, Math.max(MIN_BATCH_SIZE, value));
}

export class CleanupFolderImportsService {
  private readonly now: () => Date;
  private readonly batchSize: number;

  constructor(private readonly uow: SourceUnitOfWork, options: Options = {}) {
    this.now = options.now ?? (() => new Date());
    this.batchSize = options.batchSize === undefined ? DEFAULT_BATCH_SIZE : clampBatchSize(options.batchSize);
  }

  async cleanup(input: { now?: Date; batchSize?: number } = {}): Promise<{ deleted: number }> {
    const now = input.now ?? this.now();
    const limit = input.batchSize === undefined ? this.batchSize : clampBatchSize(input.batchSize);
    return this.uow.run(async (repositories) => {
      const candidates = await repositories.importSnapshots.listCleanupCandidates(now, limit);
      let deleted = 0;
      for (const snapshotId of candidates) {
        if (await repositories.importSnapshots.deleteIfCleanupEligible(snapshotId, now)) deleted += 1;
      }
      return { deleted };
    });
  }
}
