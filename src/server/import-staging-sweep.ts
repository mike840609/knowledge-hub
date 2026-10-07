import { DomainError } from "@/shared/domain/errors";

/** How often one server process may start a sweep; staging lifetimes are measured in hours. */
export const IMPORT_STAGING_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Expired import staging (spec §19 retention) is otherwise deleted only by a
 * script someone must remember to run, and every Preview keeps a copy of the
 * folder's Markdown. Starting a new import is when staging grows, so it is when
 * the old staging is swept: in the background, never delaying or failing the
 * request, at most once per interval and never twice at once in one process.
 * Concurrent processes are safe: each delete re-checks eligibility itself.
 */
export function createImportStagingSweep(intervalMs = IMPORT_STAGING_SWEEP_INTERVAL_MS) {
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  let running = false;
  // Monotonic by default: a wall clock stepped back (NTP, VM resume) would otherwise suppress sweeps.
  // Fire-and-forget assumes a long-lived Node process (`next start`); a request-scoped runtime would need `after()`.
  return function sweepSoon(cleanup: () => Promise<{ deleted: number }>, now = performance.now()): boolean {
    if (running || now - lastStartedAt < intervalMs) return false;
    lastStartedAt = now;
    running = true;
    void Promise.resolve()
      .then(cleanup)
      .then(({ deleted }) => {
        // Counts only (spec §18.4). Logged when it did something, so an operator can see sweeps working.
        if (deleted > 0) console.info("Import staging cleanup deleted expired snapshots", deleted);
      })
      .catch((error: unknown) => {
        // Codes only: spec §18.4 keeps raw driver text and folder content out of logs.
        console.warn("Import staging cleanup failed", error instanceof DomainError && error.code ? error.code : "PERSISTENCE_FAILURE");
      })
      .finally(() => {
        running = false;
      });
    return true;
  };
}
