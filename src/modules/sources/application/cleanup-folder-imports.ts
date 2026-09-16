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
    // Short transactions only: the candidate list is a read-only pass that commits
    // immediately, then each conditional delete runs in its own transaction so no
    // pass ever holds snapshot-row + cascaded-entry locks across up to 500 rows.
    // Each DELETE re-checks the full eligibility predicate inside the statement, so
    // a snapshot finalized concurrently after the list pass is never wrongly
    // deleted; leftovers are picked up by the next cron pass (batch-cap semantics
    // unchanged).
    const candidates = await this.uow.run(async (repositories) => {
      return repositories.importSnapshots.listCleanupCandidates(now, limit);
    });
    let deleted = 0;
    for (const snapshotId of candidates) {
      const removed = await this.uow.run(async (repositories) => {
        return repositories.importSnapshots.deleteIfCleanupEligible(snapshotId, now);
      });
      if (removed) deleted += 1;
    }
    return { deleted };
  }
}
