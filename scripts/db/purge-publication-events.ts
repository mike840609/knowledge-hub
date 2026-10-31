import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";

/** Consumed events and processed deliveries older than this are removable. */
export const DEFAULT_PURGE_RETENTION_DAYS = 30;

/** One transaction removes at most this many root events. */
const PURGE_BATCH = 500;

export type PurgeResult = {
  status: "RAN";
  events: number;
  deliveries: number;
  cutoff: Date;
};

type PurgeOptions = {
  /** Retention window; defaults to `KM_PUBLICATION_RETENTION_DAYS` or 30. */
  days?: number;
  /** Injectable clock; defaults to now. */
  now?: () => Date;
  /** Defaults to console.log; tests pass a collector. */
  log?: (line: string) => void;
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
 * an operator needs a way to keep `publication_events` and
 * `publication_event_deliveries` bounded.
 *
 * A row is removable only when the root event is consumed (at or before the
 * cutoff) and every delivery is processed; pending deliveries, unconsumed
 * events and the deliveries of retained events are untouched. Batched and
 * idempotent, and it does not look at the Team feature flag: events are
 * recorded with the flag off too.
 */
export async function purgePublicationEvents(
  pool: Pool,
  options: PurgeOptions = {},
): Promise<PurgeResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const days = options.days ?? purgeRetentionDays();
  const now = (options.now ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const uow = new MariaDbUnitOfWork(pool);

  let events = 0;
  let deliveries = 0;
  for (;;) {
    const batch = await uow.run((repositories) =>
      repositories.publications.purgeConsumedEvents(cutoff, PURGE_BATCH));
    events += batch.events;
    deliveries += batch.deliveries;
    if (batch.events === 0) break;
  }

  log(
    `Publication retention: deleted events=${events} deliveries=${deliveries} `
    + `cutoff=${cutoff.toISOString()}`,
  );
  return { status: "RAN", events, deliveries, cutoff };
}

const HELP = `Usage: npx tsx scripts/db/purge-publication-events.ts [--days N] [--target dev|test|e2e]

Deletes consumed publication events older than N days (default 30, or
KM_PUBLICATION_RETENTION_DAYS) together with their processed deliveries.
Events that are unconsumed, or that still have a pending delivery, are kept.
The Team feature flag does not affect this job: events are recorded even while
Team spaces are off. Safe to rerun and safe to schedule (for example, weekly).
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
    throw new Error("Invalid arguments. Expected: [--days N] [--target dev|test|e2e].");
  }
  const daysIndex = args.indexOf("--days");
  const days = daysIndex === -1 ? purgeRetentionDays() : Number(args[daysIndex + 1]);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error("Invalid --days value. Expected a positive number of days.");
  }

  const pool = createDatabasePool(databaseConfig(target));
  try {
    await purgePublicationEvents(pool, { days });
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
