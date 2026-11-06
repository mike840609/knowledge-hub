import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbTaskKnowledgeUnitOfWork } from "@/infrastructure/database/mariadb/task-knowledge-transaction";
import { parseTaskArtifact } from "@/modules/task-knowledge/domain/task-artifact";
import { projectTaskSearch } from "@/modules/task-knowledge/domain/task-search-projection";

export type TaskSearchConsistency = { missing: number; mismatched: number; complete: boolean };
export type TaskSearchBackfillResult = TaskSearchConsistency & { indexed: number; skipped: number; batches: number };

/**
 * Single-statement snapshot: do not scan in multiple independently committed
 * chunks and claim readiness from a mixed set of observed revision numbers.
 *
 * Exclude zero-revision staging rows: they have no committed Artifact and are
 * not returned by the legacy Tasks list. Rows with a positive revision
 * but no Artifact remain a hard integrity error during backfill.
 * This proves latest-revision currency at one database statement, NOT that
 * every deployed writer already emits projections. Deploy all writers first.
 */
export async function checkTaskSearchConsistency(pool: Pool): Promise<TaskSearchConsistency> {
  const [row] = await pool.query<{missing: string | number; mismatched: string | number}[]>(
    `SELECT
      COALESCE(SUM(CASE WHEN s.task_result_id IS NULL THEN 1 ELSE 0 END), 0) AS missing,
      COALESCE(SUM(CASE WHEN s.task_result_id IS NOT NULL AND s.revision_no <> t.latest_revision_no THEN 1 ELSE 0 END), 0) AS mismatched
      FROM task_results t
      LEFT JOIN task_result_search s ON s.task_result_id = t.id
      WHERE t.latest_revision_no > 0`,
  );
  const missing = Number(row?.missing ?? 0);
  const mismatched = Number(row?.mismatched ?? 0);
  return {missing,mismatched,complete:missing === 0 && mismatched === 0};
}

/**
 * Resumable per-task latest-revision projection. Every task is locked using
 * the same FOR UPDATE order as the real ingest writer and replay-safe upsert.
 * maxBatches is intended for bounded operations, testing and intentional pause.
 */
export async function backfillTaskSearch(
  pool: Pool,
  options: { batchSize?: number; maxBatches?: number } = {},
): Promise<TaskSearchBackfillResult> {
  const batchSize = options.batchSize ?? 100;
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500 ||
      !(maxBatches === Number.POSITIVE_INFINITY || (Number.isSafeInteger(maxBatches) && maxBatches > 0))) {
    throw new Error("Use batchSize 1–500 and maxBatches >= 1.");
  }
  const unitOfWork = new MariaDbTaskKnowledgeUnitOfWork(pool);
  let indexed = 0;
  let skipped = 0;
  let batches = 0;
  let afterId: string | null = null;
  while (batches < maxBatches) {
    const candidates: { id: string }[] = await pool.query<{id:string}[]>(
      `SELECT t.id FROM task_results t
       LEFT JOIN task_result_search s ON s.task_result_id = t.id
       WHERE t.latest_revision_no > 0
         AND (s.task_result_id IS NULL OR s.revision_no <> t.latest_revision_no)
         AND (? IS NULL OR t.id > ?)
       ORDER BY t.id ASC LIMIT ?`,
      [afterId, afterId, batchSize],
    );
    if (candidates.length === 0) break;
    batches++;
    for (const candidate of candidates) {
      const id = String(candidate.id);
      const wrote = await unitOfWork.run(async (repositories) => {
        // Re-read and lock current latest revision: never trust the version in
        // the preceding candidate scan during concurrent ingest.
        const task = await repositories.taskExports.lockTaskForUpdate(id);
        if (!task) return false;
        const revision = await repositories.taskExports.getRevision(task.id, task.latestRevisionNo);
        if (!revision) throw new Error("Task has no committed latest artifact.");
        const artifact = parseTaskArtifact(JSON.parse(revision.artifactJson));
        await repositories.taskExports.upsertSearchProjection(projectTaskSearch(task.id, artifact));
        return true;
      });
      if (wrote) indexed++;
      else skipped++;
    }
    afterId = String(candidates[candidates.length-1].id);
  }
  return {indexed,skipped,batches,...await checkTaskSearchConsistency(pool)};
}

const HELP = `Usage: npx tsx scripts/db/backfill-task-search.ts [--target dev|test|e2e] [--check|--run] [--batch-size N] [--max-batches N]

Default --check performs a single consistency query and does not mutate data.
Run --run only after schema 034 + all projection-writing app instances are deployed.
Use a maintenance window or low-traffic period for large batches, verify a
complete consistency check, THEN coordinate TASK_SEARCH_READ_ENABLED=true
across all readers. Do not enable reads automatically from this script.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) { console.log(HELP); return; }
  const targetIndex = args.indexOf("--target");
  const rawTarget = targetIndex < 0 ? "dev" : args[targetIndex+1];
  if (rawTarget !== "dev" && rawTarget !== "test" && rawTarget !== "e2e") throw new Error("Invalid --target.");
  if (args.includes("--check") && args.includes("--run")) throw new Error("Specify --run or --check, not both.");
  const sizeIndex = args.indexOf("--batch-size");
  const maxIndex = args.indexOf("--max-batches");
  const batchSize = sizeIndex < 0 ? undefined : Number(args[sizeIndex+1]);
  const maxBatches = maxIndex < 0 ? undefined : Number(args[maxIndex+1]);
  const pool = createDatabasePool(databaseConfig(rawTarget));
  try {
    const result = args.includes("--run")
      ? await backfillTaskSearch(pool, {batchSize,maxBatches})
      : await checkTaskSearchConsistency(pool);
    console.log(JSON.stringify(result));
    if (!result.complete) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Task Search backfill failed.");
    process.exitCode = 1;
  });
}

