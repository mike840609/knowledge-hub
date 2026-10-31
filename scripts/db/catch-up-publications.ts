import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { drainPublicationEvents } from "@/modules/sources/application/publication-drain";
import { reconcileContribution } from "@/modules/sources/application/publication-reconciler";
import { teamWorkspacesEnabled } from "@/server/config";

export type CatchUpSummary = {
  applied: number;
  pending: number;
  skipped: number;
  failed: number;
};

export type CatchUpResult = ({ status: "RAN" } & CatchUpSummary) | { status: "SKIPPED" };

type CatchUpOptions = {
  /** Defaults to console.log; tests pass a collector. */
  log?: (line: string) => void;
  /** Test seam for a forced per-contribution failure; production uses the reconciler. */
  reconcile?: typeof reconcileContribution;
};

/**
 * Team-space publication catch-up after `KM_TEAM_WORKSPACES_ENABLED` is turned
 * back on (spec "A contributor loses the right to publish").
 *
 * While the flag is off, personal events are still recorded but nothing
 * consumes them, so being behind stays detectable. This repair first drains
 * those events, then scans every publication contribution — not only ones with
 * an event — because moves, archives and source lifecycle changes can otherwise
 * be missed. Every contribution gets its own transaction and the caller-less
 * rights rule: direct members reconcile, group-only/removed contributors are
 * marked pending, an existing rights freeze is never cleared, and left or
 * archived publications are left exactly as they were. Idempotent and safe to
 * rerun.
 */
export async function catchUpPublications(
  pool: Pool,
  options: CatchUpOptions = {},
): Promise<CatchUpResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  if (!teamWorkspacesEnabled()) {
    log("Publication catch-up: skipped (KM_TEAM_WORKSPACES_ENABLED is not true).");
    return { status: "SKIPPED" };
  }

  const uow = new MariaDbUnitOfWork(pool);
  const reconcile = options.reconcile ?? reconcileContribution;

  // 1. Consume pending events. A deferred (group-only) delivery stays pending
  // for that contributor's own request and drops out of the next window.
  for (;;) {
    const drained = await drainPublicationEvents(uow, {
      judge: { kind: "NO_CALLER" },
      limit: 500,
    });
    // SKIPPED deliveries are work too: a window made only of left/archived
    // contributors must not look like an empty run and stop before a later
    // applicable event is reached.
    if (drained.processed === 0) break;
    if (drained.failed > 0) {
      log(`Publication catch-up: ${drained.failed} event delivery/deliveries failed; they stay retryable.`);
    }
  }

  // 2. Scan every contribution. Reconciliation reads current state, so the
  // drain above and this pass cannot double-apply a change.
  const contributions = await uow.run((repositories) =>
    repositories.publications.listAllContributions());
  const summary: CatchUpSummary = { applied: 0, pending: 0, skipped: 0, failed: 0 };
  for (const { publicationId, contributionId } of contributions) {
    try {
      const reconciled = await uow.run((repositories) => reconcile(repositories, {
        publicationId,
        contributionId,
        judge: { kind: "NO_CALLER" },
        now: new Date(),
      }));
      if (reconciled.state === "APPLIED") summary.applied += 1;
      else if (reconciled.state === "SKIPPED") summary.skipped += 1;
      // FROZEN cannot be decided without a caller; treat it as pending rather
      // than letting a maintenance script freeze anybody.
      else summary.pending += 1;
    } catch (error) {
      summary.failed += 1;
      console.error(
        `Publication catch-up failed for contribution ${contributionId} in publication ${publicationId}.`,
        error instanceof Error ? error.name : "UnknownError",
      );
    }
  }

  log(
    `Publication catch-up: applied=${summary.applied} pending=${summary.pending} `
    + `skipped=${summary.skipped} failed=${summary.failed}`,
  );
  return { status: "RAN", ...summary };
}

/** The CLI's exit contract: 1 when any contribution failed, 0 otherwise. */
export async function catchUpExitCode(
  pool: Pool,
  options: CatchUpOptions = {},
): Promise<number> {
  const result = await catchUpPublications(pool, options);
  return result.status === "RAN" && result.failed > 0 ? 1 : 0;
}

const HELP = `Usage: npx tsx scripts/db/catch-up-publications.ts [--target dev|test|e2e]

Reconciles every Team publication after KM_TEAM_WORKSPACES_ENABLED has been
turned back on. The flag must be true; otherwise the script prints "skipped"
and writes nothing. Contributions whose rights cannot be judged without their
own request stay pending until that contributor saves or syncs again.
Idempotent and safe to rerun.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }
  const targetIndex = args.indexOf("--target");
  const target = targetIndex === -1 ? "dev" : args[targetIndex + 1];
  if (target !== "dev" && target !== "test" && target !== "e2e") {
    throw new Error("Invalid arguments. Expected: [--target dev|test|e2e].");
  }
  const pool = createDatabasePool(databaseConfig(target));
  try {
    const exitCode = await catchUpExitCode(pool);
    if (exitCode !== 0) process.exitCode = exitCode;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
