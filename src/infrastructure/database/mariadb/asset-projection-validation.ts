import type { MigrationReadConnection } from "./migrations/types";
import { normalizeImportPath } from "@/modules/sources/domain/import-path";
import { SourceImportError } from "@/modules/sources/domain/import-errors";

const GATE_BATCH_SIZE = 500;

type AssetRow = { id: unknown; source_id: unknown; source_path: unknown };

export async function assertAssetProjectionReady(connection: MigrationReadConnection): Promise<void> {
  // Bounded pagination instead of a single full-table SELECT: the gate runs
  // under the migration lock with canonical-write quiescence, so LIMIT/OFFSET
  // pages are stable. The seen-set is retained across batches to preserve
  // cross-batch duplicate detection, at the cost of O(N) memory in the number
  // of distinct normalized (source_id, path) keys.
  const seen = new Set<string>();
  let offset = 0;
  for (;;) {
    const rows = await connection.query<AssetRow[]>(
      "SELECT id, source_id, source_path FROM knowledge_assets ORDER BY id LIMIT ? OFFSET ?",
      [GATE_BATCH_SIZE, offset],
    );
    if (rows.length === 0) break;
    for (const row of rows) {
      const assetId = String(row.id);
      const sourceId = String(row.source_id);
      const storedPath = String(row.source_path);
      let normalizedPath: string;
      try {
        normalizedPath = normalizeImportPath(storedPath).sourcePath;
      } catch (error) {
        const code = error instanceof SourceImportError ? error.code : "UNKNOWN";
        const detail = error instanceof Error ? error.message : "Invalid source path.";
        throw new Error(
          `Asset projection migration refused: asset ${assetId} has an invalid source_path (${code}: ${detail}). Fix the path to a canonical relative path, then rerun the migration.`,
        );
      }
      if (normalizedPath !== storedPath) {
        throw new Error(`Asset projection migration refused: asset ${assetId} has a non-canonical source_path.`);
      }
      const key = `${sourceId}\0${normalizedPath}`;
      if (seen.has(key)) {
        throw new Error(`Asset projection migration refused: duplicate normalized asset path ${storedPath} (asset ${assetId}).`);
      }
      seen.add(key);
    }
    if (rows.length < GATE_BATCH_SIZE) break;
    offset += rows.length;
  }
}
