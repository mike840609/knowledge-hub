import { readFile } from "node:fs/promises";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { affectedRows } from "@/infrastructure/database/mariadb/repositories/shared";
import {
  parseFolderMappingFile,
  preflightMapping,
  type FolderMappingInput,
  type MappingPreflight,
} from "@/infrastructure/database/mariadb/mapping-validation";
import type { MigrationReadConnection } from "@/infrastructure/database/mariadb/migrations/types";

type Queryable = Pick<MigrationReadConnection, "query">;

export async function readFolderMappingFile(path: string): Promise<FolderMappingInput> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read folder mapping file ${path}: ${error instanceof Error ? error.message : error}`);
  }
  return parseFolderMappingFile(raw);
}

export async function preflightSourceTreeMapping(queryable: Queryable, folders: FolderMappingInput): Promise<MappingPreflight> {
  return preflightMapping(queryable, folders);
}

export type BackfillResult = { applied: number; alreadyApplied: number; totalEntries: number };

export async function applySourceTreeMapping(pool: Pool, folders: FolderMappingInput): Promise<BackfillResult> {
  const preview = await preflightMapping(pool, folders);
  if (!preview.ready) {
    const summary = preview.issues.slice(0, 5).map((issue) => issue.message).join("; ");
    throw new Error(`SourceEntry→TreeNode backfill refused: ${summary}${preview.issues.length > 5 ? ` (+${preview.issues.length - 5} more)` : ""}`);
  }
  const pending = preview.planned.filter((update) => !update.alreadyApplied);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const locked = await connection.query<{ id: unknown }[]>("SELECT id FROM source_entries ORDER BY id FOR UPDATE");
    if (locked.length !== preview.totalEntries) {
      throw new Error(`SourceEntry→TreeNode backfill refused: entry count changed during apply (expected ${preview.totalEntries}, found ${locked.length}).`);
    }
    const reverified = await preflightMapping(connection, folders);
    if (!reverified.ready) {
      const summary = reverified.issues.slice(0, 5).map((issue) => issue.message).join("; ");
      throw new Error(`SourceEntry→TreeNode backfill refused inside the write transaction: ${summary}`);
    }
    let applied = 0;
    for (const update of pending) {
      const result = await connection.query("UPDATE source_entries SET tree_node_id = ? WHERE id = ? AND tree_node_id IS NULL", [update.treeNodeId, update.entryId]);
      if (affectedRows(result) !== 1) {
        throw new Error(`SourceEntry→TreeNode backfill refused: entry ${update.entryId} changed during apply.`);
      }
      applied += 1;
    }
    await connection.commit();
    return { applied, alreadyApplied: preview.planned.length - pending.length, totalEntries: preview.totalEntries };
  } catch (error) {
    try { await connection.rollback(); } catch { /* preserve the original failure */ }
    throw error;
  } finally {
    connection.release();
  }
}

function formatPreflight(preflight: MappingPreflight): string {
  const lines = [
    `entries: ${preflight.totalEntries}, pending updates: ${preflight.pendingUpdates}, ready: ${preflight.ready}`,
    ...preflight.planned.filter((update) => !update.alreadyApplied).map((update) => `  update ${update.entryId} -> ${update.treeNodeId}`),
    ...preflight.planned.filter((update) => update.alreadyApplied).map((update) => `  noop ${update.entryId} -> ${update.treeNodeId}`),
    ...preflight.issues.map((issue) => `  ${issue.code} ${issue.entryId ?? "-"}: ${issue.message}`),
  ];
  return lines.join("\n");
}

const BACKFILL_HELP = `Usage: npx tsx scripts/db/backfill-source-tree-mapping.ts --mapping <path> (--dry-run | --apply) [--target dev|test|e2e]

Backfills SourceEntry.tree_node_id after migration 004 and before migration
005 (spec §5.3). DOCUMENT entries resolve deterministically to the DOCUMENT
tree node with the same (source_id, document_id); FOLDER entries resolve
through the operator-provided mapping file:

  { "folders": { "<source-entry-id>": "<folder-tree-node-id>" } }

Provide an empty object ({ "folders": {} }) when there are no FOLDER entries.
Every ID must be a UUID. The script rejects incomplete, wrong-type,
cross-source, duplicate, conflicting, and unknown-node mappings without
writing. --dry-run never writes. --apply writes with parameterized SQL in a
single all-or-nothing DML transaction and is idempotent on rerun.

Operation rules: stop canonical writes and back up before --apply; hold write
quiescence through the following 'npm run db:migrate -- --to 5'. The DML
transaction covers data writes only — DDL interruptions keep the FAILED /
RUNNING ledger diagnostics and need explicit repair, never a blind rerun.
Mapping input never enters migration statements or checksums.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(BACKFILL_HELP);
    return;
  }
  const mappingIndex = args.indexOf("--mapping");
  const mappingPath = mappingIndex === -1 ? undefined : args[mappingIndex + 1];
  const dryRun = args.includes("--dry-run");
  const apply = args.includes("--apply");
  const targetIndex = args.indexOf("--target");
  const target = targetIndex === -1 ? "dev" : args[targetIndex + 1];
  if (!mappingPath || dryRun === apply || (target !== "dev" && target !== "test" && target !== "e2e")) {
    throw new Error("Invalid arguments. Expected: --mapping <path> (--dry-run | --apply) [--target dev|test|e2e].");
  }
  const folders = await readFolderMappingFile(mappingPath);
  const pool = createDatabasePool(databaseConfig(target));
  try {
    if (dryRun) {
      const preflight = await preflightSourceTreeMapping(pool, folders);
      console.log(formatPreflight(preflight));
      if (!preflight.ready) process.exitCode = 1;
      return;
    }
    const result = await applySourceTreeMapping(pool, folders);
    console.log(`Backfilled ${result.applied} entries (${result.alreadyApplied} already applied) of ${result.totalEntries}.`);
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
