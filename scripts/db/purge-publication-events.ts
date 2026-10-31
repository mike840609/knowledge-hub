import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { teamWorkspacesEnabled } from "@/server/config";

/** Events and deliveries older than this are removable. */
export const DEFAULT_PURGE_RETENTION_DAYS = 30;

/** One transaction removes at most this many root events. */
const PURGE_BATCH = 500;

export type PurgeResult = {
  status: "RAN";
  events: number;
  deliveries: number;
  cutoff: Date;
  /** True when old unconsumed events were eligible (the flag-off window). */
  includeUnconsumed: boolean;
};

type PurgeOptions = {
  /** Retention window; defaults to `KM_PUBLICATION_RETENTION_DAYS` or 30. */
  days?: number;
  /** Injectable clock; defaults to now. */
  now?: () => Date;
  /** Defaults to console.log; tests pass a collector. */
  log?: (line: string) => void;
  /**
   * Delete old unconsumed events too. Defaults to `!teamWorkspacesEnabled()`:
   * nothing consumes events while the flag is off, and catch-up reconciles
   * current state, so the off window can be bounded safely. Never enable this
   * while the flag is on.
   */
  includeUnconsumed?: boolean;
  /** Defaults to the deployment flag; tests may pin it. */
  teamEnabled?: () => boolean;
};

/**
 * `KM_PUBLICATION_RETENTION_DAYS` when it is a positive number, else 30.
 * Retention is read on every run so an operator can open it without a deploy.
 */
export function purgeRetentionDays(raw = process.env.KM_PUBLICATION_RETENTION_DAYS): number {
  const parsed = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : DEFAULT_PURGE_RETENTION_DAYS;
}

/**
 * Retention for the publication event log. Every personal revision/move/
 * lifecycle write records an event, including while Team publishing is off, so
 * an operator needs to keep `publication_events` and
 * `publication_event_deliveries` bounded.
 *
 * While the flag is off nothing consumes events, so every event older than the
 * cutoff is removable (its deliveries first); catch-up later reconciles each
 * contribution from current state. While the flag is on, only consumed events
 * are removed, plus unconsumed events whose pending deliveries all belong to
 * LEFT or rights-frozen contributors (they never reconcile on their own); an
 * active pending delivery, or an event with no delivery yet, is always kept.
 * Batched and idempotent.
 */
export async function purgePublicationEvents(
  pool: Pool,
  options: PurgeOptions = {},
): Promise<PurgeResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const days = options.days ?? purgeRetentionDays();
  const now = (options.now ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const enabled = (options.teamEnabled ?? teamWorkspacesEnabled)();
  const includeUnconsumed = options.includeUnconsumed ?? !enabled;
  if (includeUnconsumed && enabled) {
    throw new Error(
      "Refusing to delete unconsumed publication events while KM_TEAM_WORKSPACES_ENABLED is on.",
    );
  }
  const uow = new MariaDbUnitOfWork(pool);

  let events = 0;
  let deliveries = 0;
  for (;;) {
    const batch = await uow.run((repositories) =>
      repositories.publications.purgeEvents(cutoff, PURGE_BATCH, { includeUnconsumed }));
    events += batch.events;
    deliveries += batch.deliveries;
    if (batch.events === 0) break;
  }

  log(
    `Publication retention: deleted events=${events} deliveries=${deliveries} `
    + `cutoff=${cutoff.toISOString()} mode=${includeUnconsumed ? "flag-off" : "flag-on"}`,
  );
  return { status: "RAN", events, deliveries, cutoff, includeUnconsumed };
}

const HELP = `Usage: npx tsx scripts/db/purge-publication-events.ts [--days N] [--include-unconsumed] [--target dev|test|e2e]

Deletes publication events older than N days (default 30, or
KM_PUBLICATION_RETENTION_DAYS) together with their deliveries.

While KM_TEAM_WORKSPACES_ENABLED is off this also deletes unconsumed events:
nothing consumes them and catch-up reconciles each contribution from current
state. While the flag is on, unconsumed events are kept unless every pending
delivery belongs to a contributor who left or is rights-frozen. --include-
unconsumed forces the off-window rule and is refused while the flag is on.
Safe to rerun and suitable for a weekly schedule.
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
    throw new Error("Invalid arguments. Expected: [--days N] [--include-unconsumed] [--target dev|test|e2e].");
  }
  const daysIndex = args.indexOf("--days");
  const days = daysIndex === -1 ? purgeRetentionDays() : Number(args[daysIndex + 1]);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error("Invalid --days value. Expected a positive number of days.");
  }

  const pool = createDatabasePool(databaseConfig(target));
  try {
    await purgePublicationEvents(pool, {
      days,
      ...(args.includes("--include-unconsumed") ? { includeUnconsumed: true } : {}),
    });
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
