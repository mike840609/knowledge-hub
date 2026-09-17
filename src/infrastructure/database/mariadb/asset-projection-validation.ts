import type { MigrationReadConnection } from "./migrations/types";
import { normalizeImportPath } from "@/modules/sources/domain/import-path";
import { SourceImportError } from "@/modules/sources/domain/import-errors";

const GATE_BATCH_SIZE = 500;

type AssetRow = { id: unknown; source_id: unknown; source_path: unknown };
type DuplicateRow = { offending_id: unknown; source_path: unknown };

// Keyset pagination, not LIMIT/OFFSET. Each page is its own autocommit read
// view and the migration lock only excludes other migration runners — it does
// NOT stop application writes to knowledge_assets (write quiescence comes from
// the operator following the runbook, which we cannot enforce here). Under
// OFFSET, one concurrent DELETE shifts rows forward and the next page skips an
// unchecked window; a gate that silently passes bad rows is worse than the
// unbounded SELECT it replaced. `WHERE id > cursor` is immune to shifting and
// drops OFFSET's O(N^2) re-scan.
export async function assertAssetProjectionReady(
  connection: MigrationReadConnection,
  options: { batchSize?: number } = {},
): Promise<void> {
  const batchSize = options.batchSize ?? GATE_BATCH_SIZE;
  let cursor: string | null = null;
  for (;;) {
    // Annotated because the cursor narrowing below feeds back into this call's
    // arguments, which defeats inference (TS7022).
    const rows: AssetRow[] = await connection.query<AssetRow[]>(
      `SELECT id, source_id, source_path FROM knowledge_assets${cursor === null ? "" : " WHERE id > ?"} ORDER BY id LIMIT ?`,
      cursor === null ? [batchSize] : [cursor, batchSize],
    );
    if (rows.length === 0) break;
    for (const row of rows) assertCanonicalPath(row);
    if (rows.length < batchSize) break;
    cursor = String(rows[rows.length - 1].id);
  }
  await assertNoDuplicatePaths(connection);
}

function assertCanonicalPath(row: AssetRow): void {
  const assetId = String(row.id);
  const storedPath = String(row.source_path);
  let normalizedPath: string;
  try {
    normalizedPath = normalizeImportPath(storedPath).sourcePath;
  } catch (error) {
    // Only a domain rejection means "the stored data is wrong" — the runbook's
    // remediation (rewrite the path) is the right advice only for that. Any
    // other throw is our own fault and must surface as itself, matching
    // finalize-folder-import.ts's rethrow convention.
    if (!(error instanceof SourceImportError)) throw error;
    throw new Error(
      `Asset projection migration refused: asset ${assetId} has an invalid source_path (${error.code}: ${error.message}). Fix the path to a canonical relative path, then rerun the migration.`,
      { cause: error },
    );
  }
  if (normalizedPath !== storedPath) {
    throw new Error(`Asset projection migration refused: asset ${assetId} has a non-canonical source_path.`);
  }
}

// Duplicate detection is exactly what 007's UNIQUE (source_id,
// source_path_hash) will enforce, so push it down instead of accumulating an
// O(N) key set in this process. This runs only after every row is proven
// canonical, at which point stored path == normalized path, so grouping by the
// stored path is equivalent to grouping by the normalized one. A collision
// that only appears after normalization is reported as non-canonical first;
// the operator fixes that, reruns, and then sees the duplicate (the two-pass
// remediation the runbook already describes).
async function assertNoDuplicatePaths(connection: MigrationReadConnection): Promise<void> {
  const duplicates = await connection.query<DuplicateRow[]>(
    `SELECT MAX(id) AS offending_id, source_path FROM knowledge_assets
     GROUP BY source_id, source_path HAVING COUNT(*) > 1 ORDER BY offending_id LIMIT 1`,
  );
  const duplicate = duplicates[0];
  if (!duplicate) return;
  throw new Error(
    `Asset projection migration refused: duplicate normalized asset path ${String(duplicate.source_path)} (asset ${String(duplicate.offending_id)}).`,
  );
}
