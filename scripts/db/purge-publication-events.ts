import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { teamWorkspacesEnabled } from "@/server/config";

/** Events and deliveries older than this are removable. */
export const DEFAULT_PURGE_RETENTION_DAYS = 30;

/** One transaction removes at most this many root events. */
const PURGE_BATCH = 500;

export type PurgeMode = "flag-on" | "flag-off";

export type PurgeResult = {
  status: "RAN";
  events: number;
  deliveries: number;
  cutoff: Date;
  /** True when old unconsumed events were eligible (the flag-off window). */
  includeUnconsumed: boolean;
  mode: PurgeMode;
};

type PurgeOptions = {
  /** Retention window; defaults to `KM_PUBLICATION_RETENTION_DAYS` or 30. */
  days?: number;
  /** Injectable clock; defaults to now. */
  now?: () => Date;
  /** Defaults to console.log; tests pass a collector. */
  log?: (line: string) => void;
  /**
   * The deployment rule this run acts under. It is deliberately explicit:
   * inferring it from the process environment let a cron shell with no
   * `KM_TEAM_WORKSPACES_ENABLED` silently take the destructive flag-off mode
   * and delete pending deliveries. `flag-off` deletes old unconsumed events;
   * `flag-on` keeps them unless every pending delivery is LEFT/frozen.
   */
  mode?: PurgeMode;
  /**
   * Explicit override for the flag-off rule. Kept for the CLI's
   * `--include-unconsumed`; a run must pass either `mode` or this. Never enable
   * it while the flag is on.
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
  if (options.mode === undefined && options.includeUnconsumed === undefined) {
    throw new Error(
      "Refusing to choose a retention mode from the environment; pass --mode=flag-on or --mode=flag-off.",
    );
  }
  if (options.mode === "flag-on" && options.includeUnconsumed === true) {
    throw new Error(
      "--include-unconsumed is the flag-off rule and cannot be combined with --mode=flag-on.",
    );
  }
  const mode: PurgeMode = options.mode
    ?? (options.includeUnconsumed === true ? "flag-off" : "flag-on");
  const includeUnconsumed = mode === "flag-off";
  const enabled = (options.teamEnabled ?? teamWorkspacesEnabled)();
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
    + `cutoff=${cutoff.toISOString()} mode=${mode}`,
  );
  return { status: "RAN", events, deliveries, cutoff, includeUnconsumed, mode };
}

function parseMode(args: readonly string[]): PurgeMode | undefined {
  let raw: string | undefined;
  const inline = args.find((arg) => arg.startsWith("--mode="));
  if (inline !== undefined) raw = inline.slice("--mode=".length);
  else {
    const index = args.indexOf("--mode");
    if (index !== -1) raw = args[index + 1];
  }
  if (raw === undefined) return undefined;
  if (raw !== "flag-on" && raw !== "flag-off") {
    throw new Error("Invalid --mode value. Expected flag-on or flag-off.");
  }
  return raw;
}

const HELP = `Usage: npx tsx scripts/db/purge-publication-events.ts --mode=flag-on|flag-off [--days N] [--target dev|test|e2e]

Deletes publication events older than N days (default 30, or
KM_PUBLICATION_RETENTION_DAYS) together with their deliveries.

A mode is required; the job never infers the destructive rule from a shell
that may not carry the deployment's KM_TEAM_WORKSPACES_ENABLED.

  --mode=flag-on   Keep unconsumed events unless every pending delivery belongs
                   to a contributor who left or is rights-frozen.
  --mode=flag-off  Delete old unconsumed events too. Nothing consumes them while
                   the flag is off, and catch-up reconciles from current state.

--include-unconsumed is the explicit legacy spelling of the flag-off rule and
is refused while the deployment flag is on. Safe to rerun and suitable for a
weekly schedule.
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
    throw new Error(
      "Invalid arguments. Expected: --mode=flag-on|flag-off [--days N] [--include-unconsumed] [--target dev|test|e2e].",
    );
  }
  const daysIndex = args.indexOf("--days");
  const days = daysIndex === -1 ? purgeRetentionDays() : Number(args[daysIndex + 1]);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error("Invalid --days value. Expected a positive number of days.");
  }
  const mode = parseMode(args);
  if (mode === undefined && !args.includes("--include-unconsumed")) {
    throw new Error("Specify --mode=flag-on or --mode=flag-off (never inferred from the environment).");
  }

  const pool = createDatabasePool(databaseConfig(target));
  try {
    await purgePublicationEvents(pool, {
      days,
      ...(mode === undefined ? {} : { mode }),
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
