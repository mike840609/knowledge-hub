import type { RightsJudge } from "../domain/publication";
import type { SourceUnitOfWork } from "../ports/unit-of-work";
import { reconcileContribution, type ReconcileState } from "./publication-reconciler";

export type PublicationDrainSummary = {
  applied: number;
  pending: number;
  frozen: number;
  failed: number;
};

const DEFAULT_BATCH = 100;

type PendingDelivery = {
  eventId: string;
  contributionId: string;
  publicationId: string;
};

type ContributionBatch = {
  contributionId: string;
  publicationId: string;
  rows: PendingDelivery[];
};

function deliveryKey(row: PendingDelivery): string {
  return `${row.eventId}:${row.contributionId}`;
}

/**
 * All deliveries for one contribution are reconciled together. A sync can
 * produce several events (a swap, a rename, a revision); reconciliation reads
 * current state, so one pass resolves the whole batch. Order is preserved so
 * the first publication/contribution seen decides the grouping.
 */
function groupByContribution(rows: readonly PendingDelivery[]): ContributionBatch[] {
  const batches = new Map<string, ContributionBatch>();
  for (const row of rows) {
    const batch = batches.get(row.contributionId);
    if (batch) batch.rows.push(row);
    else batches.set(row.contributionId, {
      contributionId: row.contributionId,
      publicationId: row.publicationId,
      rows: [row],
    });
  }
  return [...batches.values()];
}

/**
 * Reconciles one contribution and marks all of its deliveries in the same
 * transaction. A reconcile failure rolls back both the team writes and the
 * delivery marks, so the root event stays unconsumed and retryable.
 */
async function deferBatch(
  uow: SourceUnitOfWork,
  batch: ContributionBatch,
  nextAttemptAt: Date,
): Promise<void> {
  try {
    await uow.run(async (repositories) => {
      for (const row of batch.rows) {
        await repositories.publications.deferDelivery(
          row.eventId,
          row.contributionId,
          nextAttemptAt,
        );
      }
    });
  } catch {
    // The rows stay pending; the next run retries them.
  }
}

async function deliverContribution(
  uow: SourceUnitOfWork,
  batch: ContributionBatch,
  judge: RightsJudge,
  now: Date,
  retryDelayMs: number,
): Promise<ReconcileState | "FAILED"> {
  const nextAttemptAt = new Date(now.getTime() + retryDelayMs);
  try {
    return await uow.run(async (repositories) => {
      const reconciled = await reconcileContribution(repositories, {
        publicationId: batch.publicationId,
        contributionId: batch.contributionId,
        judge,
        now,
      });
      const outcome = reconciled.state === "APPLIED"
        ? "APPLIED"
        : reconciled.state === "SKIPPED"
          ? "SKIPPED"
          : null;
      if (outcome !== null) {
        for (const row of batch.rows) {
          await repositories.publications.completeDelivery(
            row.eventId,
            row.contributionId,
            outcome,
          );
        }
      } else if (judge.kind === "NO_CALLER") {
        // A worker cannot judge group-derived rights and must not clear a
        // freeze, so keep these rows out of its next bounded head window. The
        // contributor's own caller-scoped drain ignores this backoff.
        for (const row of batch.rows) {
          await repositories.publications.deferDelivery(
            row.eventId,
            row.contributionId,
            nextAttemptAt,
          );
        }
      }
      return reconciled.state;
    });
  } catch (error) {
    console.error(
      "Publication drain failed for one contribution.",
      error instanceof Error ? error.name : "UnknownError",
    );
    if (judge.kind === "NO_CALLER") await deferBatch(uow, batch, nextAttemptAt);
    return "FAILED";
  }
}

/**
 * Consume personal-write events after their original transaction committed.
 *
 * `CALLER` drains only that person's contributions (pending and rights-frozen
 * included), judging their rights with their validated groups. `NO_CALLER`
 * drains every eligible target: direct members apply, group-only contributors
 * stay pending, and an existing rights freeze is never cleared.
 *
 * Prepare happens once per run so events inserted while this batch is being
 * processed remain visible to the next run. Each contribution is reconciled at
 * most once per batch; the reconciler is state-based, so late or repeated
 * events cannot regress a team document.
 */
export async function drainPublicationEvents(
  uow: SourceUnitOfWork,
  input: {
    judge: RightsJudge;
    limit?: number;
    /** Injectable clock for deterministic backoff in tests. */
    now?: () => Date;
    /** How long a worker leaves an unprocessable delivery out of its head window. */
    retryDelayMs?: number;
  },
): Promise<PublicationDrainSummary> {
  const summary: PublicationDrainSummary = { applied: 0, pending: 0, frozen: 0, failed: 0 };
  const batchSize = Math.max(1, Math.trunc(input.limit ?? DEFAULT_BATCH));
  const userId = input.judge.kind === "CALLER" ? input.judge.caller.identity.id : undefined;
  const clock = input.now ?? (() => new Date());
  const retryDelayMs = input.retryDelayMs ?? 60_000;

  await uow.run((repositories) => repositories.publications.prepareDeliveries(batchSize));

  let remaining = batchSize;
  const attempted = new Set<string>();
  while (remaining > 0) {
    const now = clock();
    const rows = await uow.run((repositories) =>
      repositories.publications.listPendingEvents(
        userId,
        remaining,
        now,
        input.judge.kind === "NO_CALLER",
      ));
    const fresh = rows.filter((row) => !attempted.has(deliveryKey(row)));
    if (fresh.length === 0) break;
    for (const row of fresh) attempted.add(deliveryKey(row));
    remaining -= fresh.length;

    for (const batch of groupByContribution(fresh)) {
      const state = await deliverContribution(uow, batch, input.judge, now, retryDelayMs);
      const count = batch.rows.length;
      if (state === "APPLIED") summary.applied += count;
      else if (state === "PENDING") summary.pending += count;
      else if (state === "FROZEN") summary.frozen += count;
      else if (state === "FAILED") summary.failed += count;
      // SKIPPED (left, archived publication) completes the delivery but has no
      // counter in the result contract.
    }
  }
  return summary;
}
